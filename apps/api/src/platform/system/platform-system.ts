import { Injectable } from '@nestjs/common';
import { AuthRuntime } from '../../identity/auth-runtime';
import { PlatformSystemDatabase } from './database';
import { PlatformDepartments } from './departments';
import { PlatformDictionaries } from './dictionaries';
import { PlatformEmployees } from './employees';
import { PlatformMenus } from './menus';
import { PlatformParameters } from './parameters';
import { PlatformPosts } from './posts';
import { PlatformRoles } from './roles';

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
