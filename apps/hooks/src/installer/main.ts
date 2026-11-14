import { createContainer } from '@/installer/container.ts';
import { InstallerCli } from '@/installer/installer-cli.ts';

const [action = 'install', target = 'all'] = process.argv.slice(2);
process.exit(createContainer().resolve(InstallerCli).run(action, target) ? 0 : 1);
