function getConfig() {
  const props = PropertiesService.getScriptProperties();
  return {
    neonDatabaseUrl: props.getProperty('DATABASE_URL') || '',
    // Clerk JWT verification (see docs/006 + lib/auth.ts).
    // CLERK_ISSUER is required for issuer validation; CLERK_AUDIENCE is optional.
    clerkJwksUrl: props.getProperty('CLERK_JWKS_URL') || '',
    clerkIssuer: props.getProperty('CLERK_ISSUER') || '',
    clerkAudience: props.getProperty('CLERK_AUDIENCE') || '',
  };
}
