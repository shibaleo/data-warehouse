function getConfig() {
  const props = PropertiesService.getScriptProperties();
  return {
    togglApiToken: props.getProperty('TOGGL_API_TOKEN') || '',
    togglWorkspaceId: props.getProperty('TOGGL_WORKSPACE_ID') || '',
    neonDatabaseUrl: props.getProperty('DATABASE_URL') || '',
  };
}
