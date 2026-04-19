export async function createTestServer() {
  process.env.DB_PATH = ':memory:';
  const { default: app } = await import('../app.js');

  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      resolve({
        url: `http://localhost:${port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}
