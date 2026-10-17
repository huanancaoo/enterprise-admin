import { Injectable } from '@nestjs/common';
import { AuthRuntime } from '../identity/auth-runtime';
import { PlatformSystemDatabase } from './platform-system/database';
import { PlatformEmployees } from './platform-system/employees';
import { PlatformRoles } from './platform-system/roles';
import { PlatformMenus } from './platform-system/menus';
import { PlatformDepartments } from './platform-system/departments';
import { PlatformPosts } from './platform-system/posts';
import { PlatformDictionaries } from './platform-system/dictionaries';
import { PlatformParameters } from './platform-system/parameters';

@Injectable()
export class PlatformSystem {
  readonly employees: PlatformEmployees;
  readonly roles: PlatformRoles;
  readonly menus: PlatformMenus;
  readonly departments: PlatformDepartments;
  readonly posts: PlatformPosts;
  readonly dictionaries: PlatformDictionaries;
  readonly parameters: PlatformParameters;

  constructor(runtime: AuthRuntime) {
    const database = new PlatformSystemDatabase(runtime.pool);
    this.employees = new PlatformEmployees(database);
    this.roles = new PlatformRoles(database);
    this.menus = new PlatformMenus(database);
    this.departments = new PlatformDepartments(database);
    this.posts = new PlatformPosts(database);
    this.dictionaries = new PlatformDictionaries(database);
    this.parameters = new PlatformParameters(database);
  }
}
