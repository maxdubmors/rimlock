// FormDetector's Proton implementation imports Proton; it still never touches storage (violation).
import { prepass } from '@protontech/autofill';
import { storage } from 'wxt/utils/storage';

export const used = [prepass, storage];
