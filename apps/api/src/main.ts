import { operationalNestLogger } from './http/operational-logger';
import { readApplicationConfig } from './config/application-config';
import { EmailRuntime } from './email/email-runtime';
import { createApplication } from './create-application';
import { FileMaintenance } from './files/file-maintenance';
import { startBusinessDeliveries } from './start-business-deliveries';

async function bootstrap() {
  const app = await createApplication(readApplicationConfig(process.env), {
    logger: operationalNestLogger,
  });
  await app.listen(process.env.PORT ?? 3000);
  app.get(EmailRuntime).start();
  app.get(FileMaintenance).start();
  startBusinessDeliveries(app);
}

void bootstrap();
