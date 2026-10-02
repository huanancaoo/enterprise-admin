import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import type {
  FileVersionReference,
  ProjectAttachmentsResponse,
  ProjectContentResponse,
  SaveProjectContent,
  SupportedLocale,
} from '@workspace/contracts';
import {
  createTenantRunner,
  type TenantContext,
  type TenantTx,
} from '@workspace/database/tenant';
import { fileRepository } from '@workspace/database/repositories/files';
import { projectRepository } from '@workspace/database/repositories/projects';
import { auditRepository } from '@workspace/database/repositories/audit';
import { AuthRuntime } from '../identity/auth-runtime';
import {
  AuthorizationService,
  type PermissionRequest,
} from '../authorization/authorization.service';
import { rethrowTenantWriteError } from '../tenancy/tenant-write';
import { rethrowFileError } from '../files/file-http-errors';
import { ApiException } from '../http/api-exception';
import { projectContentReferences } from './project-content-references';

@Injectable()
export class ProjectFiles {
  constructor(
    private readonly runtime: AuthRuntime,
    private readonly authorization: AuthorizationService,
  ) {}

  async transaction<T>(
    context: TenantContext,
    headers: Headers,
    permissions: readonly PermissionRequest[],
    work: (tx: TenantTx) => Promise<T>,
  ): Promise<T> {
    const client: PoolClient = await this.runtime.pool.connect();
    try {
      return await createTenantRunner(client)(context, async (tx) => {
        // 引用写、路径操作和清理遵循 usage→Session/status/member→项目/版本的同一锁序。
        await fileRepository.lockOrganization(tx);
        const session = await this.runtime.auth.withDatabaseClient(client, () =>
          this.runtime.auth.api.getSession({
            headers,
            query: { disableCookieCache: true, disableRefresh: true },
          }),
        );
        if (!session || session.user.id !== context.userId)
          throw new UnauthorizedException();
        await fileRepository.requireCurrentActor(tx, session.session.id);
        await this.authorization.requireAnyPermissionInTransaction(
          client,
          headers,
          context.organizationId,
          permissions,
        );
        const result = await work(tx);
        // 写入等待之后仍以数据库时钟和持锁连接确认权限，任何拒绝都回滚业务与引用。
        await this.authorization.requireAnyPermissionInTransaction(
          client,
          headers,
          context.organizationId,
          permissions,
        );
        await fileRepository.requireCurrentActor(tx, session.session.id);
        return result;
      }).catch((error: unknown) => rethrowTenantWriteError(error, context));
    } catch (error) {
      rethrowFileError(error);
    } finally {
      client.release();
    }
  }

  async replaceAttachments(
    tx: TenantTx,
    projectId: string,
    items: FileVersionReference[],
    expectedRevision?: number,
  ) {
    const project = await projectRepository.findForUpdate(tx, projectId);
    if (!project) throw new NotFoundException();
    if (
      expectedRevision !== undefined &&
      project.attachmentsRevision !== expectedRevision
    )
      throw new ApiException(409, 'VERSION_CONFLICT', {
        revision: project.attachmentsRevision,
      });
    await fileRepository.replaceReferences(
      tx,
      { projectId, kind: 'project_attachment', locale: null },
      items.map((item, position) => ({
        ...item,
        referenceKey: String(position),
        position,
      })),
    );
    if (expectedRevision !== undefined)
      await projectRepository.advanceAttachmentsRevision(tx, projectId);
  }

  getAttachments(
    context: TenantContext,
    projectId: string,
    headers: Headers,
  ): Promise<ProjectAttachmentsResponse> {
    return this.transaction(
      context,
      headers,
      [{ project: ['read'] }],
      async (tx) => {
        const project = await projectRepository.find(tx, projectId);
        if (!project) throw new NotFoundException();
        const references = await fileRepository.projectAttachments(
          tx,
          projectId,
        );
        return {
          revision: project.attachmentsRevision,
          items: references.map((reference) => ({
            fileId: reference.fileId,
            versionId: reference.versionId,
            name: reference.name,
            bytes: reference.bytes,
            contentType: reference.contentType,
            versionCreatedAt: reference.versionCreatedAt.toISOString(),
          })),
        };
      },
    );
  }

  getContent(
    context: TenantContext,
    projectId: string,
    locale: SupportedLocale,
    headers: Headers,
  ): Promise<ProjectContentResponse> {
    return this.transaction(
      context,
      headers,
      [{ project: ['read'] }],
      async (tx) => {
        if (!(await projectRepository.find(tx, projectId)))
          throw new NotFoundException();
        const content = await fileRepository.findProjectContent(
          tx,
          projectId,
          locale,
        );
        return {
          locale,
          revision: content?.revision ?? null,
          document: content
            ? projectContentReferences(content.document).document
            : null,
          updatedAt: content?.updatedAt.toISOString() ?? null,
        };
      },
    );
  }

  saveContent(
    context: TenantContext,
    projectId: string,
    locale: SupportedLocale,
    input: SaveProjectContent,
    headers: Headers,
  ): Promise<ProjectContentResponse> {
    const { document, references } = projectContentReferences(input.document);
    const files: PermissionRequest = references.length
      ? { file: ['read'] }
      : {};
    return this.transaction(
      context,
      headers,
      [
        { project: ['update'], ...files },
        { project: ['translate'], ...files },
      ],
      async (tx) => {
        if (!(await projectRepository.findForUpdate(tx, projectId)))
          throw new NotFoundException();
        for (const reference of references) {
          const { version } = await fileRepository.findVersion(
            tx,
            reference.fileId,
            reference.versionId,
            'share',
          );
          if (
            reference.image &&
            !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(
              version.contentType,
            )
          )
            throw new BadRequestException(
              'Image references require a supported image version',
            );
        }
        const content = await fileRepository.saveProjectContent(
          tx,
          { projectId, kind: 'project_rich_text', locale },
          {
            expectedRevision: input.expectedRevision,
            document,
            references: references.map(
              ({ fileId, versionId, referenceKey, position }) => ({
                fileId,
                versionId,
                referenceKey,
                position,
              }),
            ),
          },
        );
        await projectRepository.touch(tx, projectId);
        await auditRepository.record(tx, {
          eventCode: 'project.content.updated',
          resourceId: projectId,
          fields: { locale, revision: content.revision },
        });
        return {
          locale,
          document,
          revision: content.revision,
          updatedAt: content.updatedAt.toISOString(),
        };
      },
    );
  }
}
