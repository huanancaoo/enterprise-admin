import "reflect-metadata"
import {
  Body,
  Controller,
  Get,
  Module,
  Param,
  Post,
  Query,
  StandardSchemaValidationPipe,
} from "@nestjs/common"
import { NestFactory } from "@nestjs/core"
import { type NestExpressApplication } from "@nestjs/platform-express"
import {
  ApiCreatedResponse,
  ApiOperation,
  DocumentBuilder,
  SwaggerModule,
} from "@nestjs/swagger"
import { toNodeHandler } from "better-auth/node"
import express from "express"
import { z } from "zod"
import type { createAuth } from "./auth.js"

// 这是兼容性探针的协议，不是 S5 的 Projects 业务契约。
export const probeSchema = z.strictObject({
  organizationId: z.uuid(),
  name: z.string().min(1).max(80),
})
const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
})

@Controller("api/v1/probe")
class ProbeController {
  @Post()
  @ApiOperation({ operationId: "createProbe" })
  @ApiCreatedResponse({ standardSchema: probeSchema })
  create(@Body({ schema: probeSchema }) body: z.infer<typeof probeSchema>) {
    return body
  }

  @Get(":organizationId")
  @ApiOperation({ operationId: "listProbes" })
  list(
    @Param("organizationId", { schema: z.uuid() }) organizationId: string,
    @Query({ schema: querySchema }) query: z.infer<typeof querySchema>
  ) {
    return { organizationId, page: query.page }
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

export async function startProbe(
  authFactory: (url: string) => ReturnType<typeof createAuth>
) {
  const app = await NestFactory.create<NestExpressApplication>(ProbeModule, {
    bodyParser: false,
    logger: false,
  })
  let handler: ReturnType<typeof toNodeHandler>
  // Better Auth 必须读取原始请求流，所以认证 Handler 在 Express JSON parser 之前挂载。
  app.use("/api/auth", (req: express.Request, res: express.Response) =>
    handler(req, res)
  )
  app.use(express.json())
  app.useGlobalPipes(new StandardSchemaValidationPipe())
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("S0 compatibility probe")
      .setVersion("1.0.0")
      .build()
  )
  await app.listen(0, "127.0.0.1")
  const url = await app.getUrl()
  const auth = authFactory(url)
  handler = toNodeHandler(auth)
  return { app, document, url, auth }
}
