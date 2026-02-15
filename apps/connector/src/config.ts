function getConfig() {
  const props = PropertiesService.getScriptProperties();
  return {
    neonDatabaseUrl: props.getProperty('DATABASE_URL') || '',
  };
}
