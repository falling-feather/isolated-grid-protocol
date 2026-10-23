import { mkdir, copyFile, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(project, 'dist');
await mkdir(target, { recursive: true });
for (const name of ['index.html', 'styles.css','journey.css','review.css']) {
  await copyFile(resolve(project, 'public', name), resolve(target, name));
}
await mkdir(resolve(target,'assets'),{recursive:true});
await cp(resolve(project,'public/assets'),resolve(target,'assets'),{recursive:true});
console.log('已构建 dist/：静态页面与独立模拟 Worker');
