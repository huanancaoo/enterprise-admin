import { ConsoleLogger } from '@nestjs/common';
import { readAuthConfig } from './auth-runtime';
import { createApplication } from './create-application';

async function bootstrap() {
  const app = await createApplication(readAuthConfig(process.env), {
    logger: new ConsoleLogger({ json: true }),
  });
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
