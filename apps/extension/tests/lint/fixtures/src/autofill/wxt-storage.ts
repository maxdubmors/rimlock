// Violation: content code imports the WXT storage modules.
import { storage } from 'wxt/utils/storage';
import { storage as standalone } from '@wxt-dev/storage';

export const settings = [storage, standalone];
