const unavailable = (name) => () => {
  throw new Error(
    `drizzle-kit's ${name}() is not available on Workers. Schema changes are made ` +
      `with \`./cf npm run migrate:create\` locally and applied with \`./cf npm run migrate\`; ` +
      `nothing should be diffing or pushing schema at runtime.`,
  )
}

export const generateDrizzleJson = unavailable('generateDrizzleJson')
export const generateMigration = unavailable('generateMigration')
export const pushSchema = unavailable('pushSchema')
export const generateSQLiteDrizzleJson = unavailable('generateSQLiteDrizzleJson')
export const generateSQLiteMigration = unavailable('generateSQLiteMigration')
export const pushSQLiteSchema = unavailable('pushSQLiteSchema')
export const upPgSnapshot = unavailable('upPgSnapshot')
export const upSQLiteSnapshot = unavailable('upSQLiteSnapshot')

export default {
  generateDrizzleJson,
  generateMigration,
  pushSchema,
  generateSQLiteDrizzleJson,
  generateSQLiteMigration,
  pushSQLiteSchema,
  upPgSnapshot,
  upSQLiteSnapshot,
}
