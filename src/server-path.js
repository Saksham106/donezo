import { resolve, sep } from 'node:path';

export function safeStaticPath(root, pathname) {
  const decoded = decodeURIComponent(pathname);
  const relative = decoded.replace(/^[/\\]+/, '');
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(resolvedRoot, relative);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error('Invalid path');
  }
  return resolvedPath;
}
