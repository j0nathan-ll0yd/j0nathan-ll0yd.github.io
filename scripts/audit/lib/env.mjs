export function getOptionalEnv(name, defaultValue = undefined) {
  const value = process.env[name]
  return value === undefined || value === '' ? defaultValue : value
}

export function getRequiredEnv(name) {
  const value = getOptionalEnv(name)
  if (value === undefined) {
    throw new Error(`Required environment variable ${name} is not set`)
  }
  return value
}
