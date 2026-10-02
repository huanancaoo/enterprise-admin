import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateProject,
  UpdateProject,
  ProjectResponse,
  ProjectTranslationResponse,
  ProjectListQuery,
  ProjectPage,
  SupportedLocale,
} from '@workspace/contracts';
import {
  createTenantRunner,
  type TenantContext,
  type TenantTx,
} from '@workspace/database/tenant';
import { projectRepository } from '@workspace/database/repositories/projects';
import { auditRepository } from '@workspace/database/repositories/audit';
import { AuthRuntime } from '../identity/auth-runtime';
import { ProjectFiles } from './project-files';
import type { PermissionRequest } from '../authorization/authorization.service';

// 调用者提供经组织授权的上下文；项目规则、写入锁与审计必须在本 module 内共同演进。
@Injectable()
export class Projects {
  constructor(
    private readonly runtime: AuthRuntime,
    private readonly files: ProjectFiles,
  ) {}

  private async requireForMutation(tx: TenantTx, projectId: string) {
    // 资源范围在写事务内锁定；跨组织和不存在统一为 404，不增加负责人或状态限制。
    const project = await projectRepository.findForUpdate(tx, projectId);
    if (!project) throw new NotFoundException();
    return project;
  }

  async create(
    context: TenantContext,
    input: CreateProject,
    headers: Headers,
  ): Promise<ProjectResponse> {
    const files: PermissionRequest = input.attachments?.length
      ? { file: ['read'] }
      : {};
    return this.files.transaction(
      context,
      headers,
      [{ project: ['create'], ...files }],
      async (tx) => {
        const contentLocale =
          input.contentLocale ?? (await projectRepository.defaultLocale(tx));
        const project = await projectRepository.create(tx, {
          ...input,
          contentLocale,
        });
        if (input.attachments)
          await this.files.replaceAttachments(
            tx,
            project.id,
            input.attachments,
          );
        // 与项目和基础译文共用 TenantTx，审计失败必须回滚整个创建。
        await auditRepository.record(tx, {
          eventCode: 'project.created',
          resourceId: project.id,
          fields: { status: project.status, contentLocale },
        });
        return {
          id: project.id,
          organizationId: project.organizationId,
          status: project.status,
          contentLocale: project.contentLocale,
          name: input.name,
          description: input.description,
          resolvedLocale: contentLocale,
          createdAt: project.createdAt.toISOString(),
          updatedAt: project.updatedAt.toISOString(),
        };
      },
    );
  }

  async list(
    context: TenantContext,
    query: ProjectListQuery,
  ): Promise<ProjectPage> {
    const page = await createTenantRunner(this.runtime.pool)(context, (tx) =>
      projectRepository.listPage(tx, query),
    );
    return {
      ...page,
      items: page.items.map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      })),
    };
  }

  async get(
    context: TenantContext,
    projectId: string,
  ): Promise<ProjectResponse> {
    const project = await createTenantRunner(this.runtime.pool)(context, (tx) =>
      projectRepository.findLocalized(tx, projectId),
    );
    if (!project) throw new NotFoundException();
    return {
      ...project,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    };
  }

  async delete(
    context: TenantContext,
    projectId: string,
    headers: Headers,
  ): Promise<void> {
    await this.files.transaction(
      context,
      headers,
      [{ project: ['delete'] }],
      async (tx) => {
        const project = await this.requireForMutation(tx, projectId);
        const [deleted] = await projectRepository.delete(tx, project.id);
        if (!deleted) throw new NotFoundException();
        // 删除与审计共用事务；审计未写入时，级联删除的项目及全部译文必须回滚。
        await auditRepository.record(tx, {
          eventCode: 'project.deleted',
          resourceId: deleted.id,
          fields: {
            status: deleted.status,
            contentLocale: deleted.contentLocale,
          },
        });
      },
    );
  }

  async getTranslation(
    context: TenantContext,
    projectId: string,
    locale: SupportedLocale,
  ): Promise<ProjectTranslationResponse> {
    const translation = await createTenantRunner(this.runtime.pool)(
      context,
      async (tx) => {
        const project = await projectRepository.find(tx, projectId);
        if (!project) return undefined;
        const record = await projectRepository.findTranslation(
          tx,
          projectId,
          locale,
        );
        // 基础译文是数据不变量；不能把缺失基础译文误报为可新建的目标语言。
        if (!record && project.contentLocale === locale)
          throw new Error('Project base translation is missing');
        return record;
      },
    );
    if (!translation) throw new NotFoundException();
    return {
      locale: translation.locale,
      name: translation.name,
      description: translation.description,
    };
  }

  async update(
    context: TenantContext,
    projectId: string,
    input: UpdateProject,
    headers: Headers,
  ): Promise<ProjectResponse> {
    // 附件属于项目本身；翻译资格只允许按内容语言维护译文或富文本。
    const projectAction =
      input.status !== undefined || input.attachments !== undefined;
    const files: PermissionRequest = input.attachments?.items.length
      ? { file: ['read'] }
      : {};
    const permissions: readonly PermissionRequest[] = projectAction
      ? [{ project: ['update'], ...files }]
      : [{ project: ['update'] }, { project: ['translate'] }];
    const project = await this.files.transaction(
      context,
      headers,
      permissions,
      async (tx) => {
        const current = await this.requireForMutation(tx, projectId);
        let statusChanged = false;
        if (input.status !== undefined && input.status !== current.status) {
          await projectRepository.updateStatus(tx, projectId, input.status);
          statusChanged = true;
          await auditRepository.record(tx, {
            eventCode: 'project.updated',
            resourceId: projectId,
            fields: { status: input.status },
          });
        }
        if (input.translation) {
          const existing = await projectRepository.findTranslation(
            tx,
            projectId,
            input.translation.locale,
          );
          if (!existing && current.contentLocale === input.translation.locale)
            throw new Error('Project base translation is missing');
          const name = input.translation.name ?? existing?.name;
          if (!name)
            throw new BadRequestException('New translations require a name');
          const description =
            input.translation.description === undefined
              ? (existing?.description ?? null)
              : input.translation.description;
          await projectRepository.upsertTranslation(tx, {
            projectId,
            locale: input.translation.locale,
            name,
            description,
          });
          // 译文本身不带更新时间，必须触及项目才能让列表的更新时间与内容事实一致。
          if (!statusChanged) await projectRepository.touch(tx, projectId);
          await auditRepository.record(tx, {
            eventCode: 'project.translation.updated',
            resourceId: projectId,
            fields: { locale: input.translation.locale },
          });
        }
        if (input.attachments) {
          await this.files.replaceAttachments(
            tx,
            projectId,
            input.attachments.items,
            input.attachments.expectedRevision,
          );
          if (!statusChanged && !input.translation)
            await projectRepository.touch(tx, projectId);
          await auditRepository.record(tx, {
            eventCode: 'project.attachments.updated',
            resourceId: projectId,
            fields: { revision: current.attachmentsRevision + 1 },
          });
        }
        return projectRepository.findLocalized(tx, projectId);
      },
    );
    if (!project) throw new NotFoundException();
    return {
      ...project,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    };
  }
}
