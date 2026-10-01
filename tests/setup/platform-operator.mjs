import { createHmac, randomBytes } from "node:crypto"
import { signUpVerified } from "./complete-signup.mjs"

export function platformTotp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
  const bits = [...secret.toUpperCase().replace(/=+$/, "")]
    .map((character) =>
      alphabet.indexOf(character).toString(2).padStart(5, "0")
    )
    .join("")
  const key = Buffer.from(
    Array.from({ length: Math.floor(bits.length / 8) }, (_, index) =>
      Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2)
    )
  )
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)))
  const digest = createHmac("sha1", key).update(counter).digest()
  const offset = digest[digest.length - 1] & 0x0f
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000)
    .toString()
    .padStart(6, "0")
}

export async function platformOperator(
  environment,
  origin,
  role = "platform_admin"
) {
  const target = await signUpVerified(
    environment.baseURL,
    origin,
    environment.migrator,
    { name: "Platform operator" }
  )
  await environment.deployerPool.query(
    `INSERT INTO public.platform_assignment
    (user_id, role, status, granted_at, granted_by, grant_reason)
    VALUES ($1, $2, 'active', clock_timestamp(), current_user, 'organization acceptance')`,
    [target.user.id, role]
  )
  let cookie = target.cookie
  const post = async (path, body) => {
    const response = await fetch(`${environment.baseURL}/api/auth/${path}`, {
      method: "POST",
      headers: {
        cookie,
        origin,
        "content-type": "application/json",
        "x-real-ip": `10.${[...randomBytes(3)].join(".")}`,
      },
      body: JSON.stringify(body),
    })
    if (!response.ok)
      throw new Error(
        `MFA setup failed: ${response.status} ${await response.text()}`
      )
    const next = response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ")
    if (next) cookie = next
    return response.json()
  }
  const enabled = await post("two-factor/enable", {
    password: target.password,
    method: "totp",
  })
  const secret = new URL(enabled.totpURI).searchParams.get("secret")
  await post("two-factor/verify-totp", { code: platformTotp(secret) })
  return { ...target, cookie, secret, headers: new Headers({ cookie, origin }) }
}
