import { randomBytes, randomUUID } from "node:crypto"

export async function signUpVerified(baseURL, origin, migrator, body = {}) {
  const email = body.email ?? `${randomUUID()}@example.test`
  const password = body.password ?? randomBytes(24).toString("hex")
  const name = body.name ?? "User"
  const signup = await fetch(`${baseURL}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ email, password, name }),
  })
  if (signup.status !== 200) {
    throw new Error(`sign-up failed: ${signup.status} ${await signup.text()}`)
  }
  const payload = await signup.json()
  await migrator.query(
    'UPDATE public."user" SET email_verified = true WHERE id = $1',
    [payload.user.id]
  )
  const signIn = await fetch(`${baseURL}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ email, password }),
  })
  if (signIn.status !== 200) {
    throw new Error(`sign-in failed: ${signIn.status} ${await signIn.text()}`)
  }
  const cookie = signIn.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ")
  return {
    user: payload.user,
    email,
    password,
    cookie,
    headers: new Headers({ cookie, origin }),
  }
}
