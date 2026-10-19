# @workspace/announcements

租户后台与平台后台共用的公告业务模块，包含收件箱、正文、附件读取及已读状态编排。

应用负责提供各自的请求函数、授权上下文、Query scope 与路由；本包保持公告协议和阅读流程一致。通用表格、编辑器与后台外壳继续由 `@workspace/admin` 提供。
