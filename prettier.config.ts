import type { Config } from 'prettier';
import irfndConfig from '@irfnd/prettier-config';

const config = {
	...irfndConfig,
} satisfies Config;

export default config;
