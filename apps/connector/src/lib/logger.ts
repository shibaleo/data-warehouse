function log(message: string, data?: unknown): void {
  if (data !== undefined) {
    Logger.log(`${message}: ${JSON.stringify(data)}`);
  } else {
    Logger.log(message);
  }
}
