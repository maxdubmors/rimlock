import { loadCoreIn } from '../../probe/load-core';

void loadCoreIn(location.search.includes('tab') ? 'tab' : 'popup');
