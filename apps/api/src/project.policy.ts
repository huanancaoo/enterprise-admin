import { Injectable, NotFoundException } from '@nestjs/common';
import { projectRepository } from '@workspace/database/repositories/projects';
import type { TenantTx } from '@workspace/database/tenant';

@Injectable()
export class ProjectPolicy {
  async requireForMutation(tx: TenantTx, projectId: string) {
    // 组织动作已在 Guard 中授权。资源范围必须在写事务内读取并锁定，
    // 不限制负责人或归档状态；跨组织和不存在统一返回 404。
    const project = await projectRepository.findForUpdate(tx, projectId);
    if (!project) throw new NotFoundException();
    return project;
  }
}
