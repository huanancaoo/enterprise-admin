import { ConsoleLogger } from '@nestjs/common';
import { readApplicationConfig } from './config/application-config';
import { EmailRuntime } from './email/email-runtime';
import { createApplication } from './create-application';

async function bootstrap() {
  const app = await createApplication(readApplicationConfig(process.env), {
    logger: new ConsoleLogger({ json: true }),
  });
  await app.listen(process.env.PORT ?? 3000);
  app.get(EmailRuntime).start();
}

void bootstrap();
