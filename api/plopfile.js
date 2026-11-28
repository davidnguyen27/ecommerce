// `pnpm --filter @ecommerce/api gen:module`: scaffolds src/modules/<name>/ with every layer (ADR 0018), for an admin
// CRUD entity backed by one Prisma model. Then fill the mapper and snapshot, add routes, and register the module in
// src/modules/index.ts.
export default function (plop) {
  const files = [
    ['module', '{{kebabCase name}}.module.ts'],
    ['route', '{{kebabCase name}}.route.ts'],
    ['controller', '{{kebabCase name}}.controller.ts'],
    ['service', '{{kebabCase name}}.service.ts'],
    ['repository', '{{kebabCase name}}.repository.ts'],
    ['mapper', '{{kebabCase name}}.mapper.ts'],
    ['interface', '{{kebabCase name}}.interface.ts'],
    ['dto', 'dto/index.ts'],
    ['index', 'index.ts'],
  ]

  plop.setGenerator('module', {
    description: 'Module with route, controller, service, repository, mapper, interface and dto',
    prompts: [
      { type: 'input', name: 'name', message: 'Module name, singular, matching the Prisma model (e.g. brand):' },
      { type: 'input', name: 'path', message: 'Admin path under /api/admin (e.g. /brands):' },
      { type: 'input', name: 'permission', message: 'Permission for every route (e.g. catalog.edit):' },
      { type: 'input', name: 'auditPrefix', message: 'Audit action prefix (e.g. catalog.brand):' },
      {
        type: 'input',
        name: 'createSchema',
        message: 'Create schema in @ecommerce/shared:',
        default: (a) => `Create${plop.getHelper('pascalCase')(a.name)}Request`,
      },
      {
        type: 'input',
        name: 'updateSchema',
        message: 'Update schema in @ecommerce/shared:',
        default: (a) => `Update${plop.getHelper('pascalCase')(a.name)}Request`,
      },
    ],
    actions: files.map(([template, file]) => ({
      type: 'add',
      path: `src/modules/{{kebabCase name}}/${file}`,
      templateFile: `plop-templates/${template}.hbs`,
    })),
  })
}
