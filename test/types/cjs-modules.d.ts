declare module "node:module" {
  export function createRequire(filename: string | URL): (id: string) => {
    [key: string]: (...args: unknown[]) => unknown;
  };
}
