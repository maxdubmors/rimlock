<script lang="ts">
  // The walking skeleton of adding a Database: a `.kdbx` and its Master password, unlocked in the
  // background (databases-and-unlock.md § Adding a Database = the first unlock). M1's add flow
  // replaces this page and keeps the background path.
  import { i18n } from '#i18n';

  import {
    sendRequest,
    type StatusResponse,
    type UnlockFailure,
    type UnlockResponse,
  } from '../protocol/messages';
  import { Secret } from '../shared/secret';

  let files = $state<FileList>();
  let masterPassword = $state('');
  let status = $state('');
  let busy = $state(false);

  function describeStatus(response: StatusResponse): string {
    if (response.core === 'unavailable') return i18n.t('statusCoreUnavailable');
    return response.unlocked === null
      ? i18n.t('statusLocked')
      : i18n.t('statusUnlocked', [response.unlocked.name]);
  }

  function describeFailure(error: UnlockFailure): string {
    switch (error.kind) {
      case 'WrongKey':
        return i18n.t('unlockWrongKey');
      case 'UnsupportedFile':
      case 'Corrupt':
        return i18n.t('unlockUnsupportedFile', [error.reason]);
      case 'Internal':
        return i18n.t('unlockFailed');
    }
  }

  function describeUnlock(response: UnlockResponse): string {
    return response.unlocked
      ? i18n.t('statusUnlocked', [response.name])
      : describeFailure(response.error);
  }

  async function unlock(): Promise<void> {
    const file = files?.[0];
    if (file === undefined || busy) return;
    busy = true;
    status = i18n.t('statusUnlocking');
    const request = {
      kind: 'unlock',
      file: new Uint8Array(await file.arrayBuffer()),
      masterPassword: Secret.fromText(masterPassword),
    } as const;
    masterPassword = '';
    try {
      status = describeUnlock(await sendRequest(request));
    } catch {
      status = i18n.t('unlockFailed');
    } finally {
      request.masterPassword.wipe();
      busy = false;
    }
  }

  function onsubmit(event: SubmitEvent): void {
    event.preventDefault();
    void unlock();
  }

  $effect(() => {
    sendRequest({ kind: 'status' }).then(
      (response) => {
        status ||= describeStatus(response);
      },
      () => {
        status ||= i18n.t('statusCoreUnavailable');
      },
    );
  });
</script>

<h1>{i18n.t('addDatabaseTitle')}</h1>
<form {onsubmit}>
  <label>
    {i18n.t('addDatabaseFile')}
    <input type="file" accept=".kdbx" bind:files required />
  </label>
  <label>
    {i18n.t('addDatabaseMasterPassword')}
    <input type="password" autocomplete="off" bind:value={masterPassword} required />
  </label>
  <button type="submit" disabled={busy}>{i18n.t('addDatabaseUnlock')}</button>
</form>
<p role="status">{status}</p>
