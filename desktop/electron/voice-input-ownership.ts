import type { VoiceInputOwner } from './contract.js';

/** Keeps the physical microphone assigned to one renderer at a time. */
export class VoiceInputOwnership {
  private ownerValue: VoiceInputOwner | null = null;
  private transition: Promise<void> = Promise.resolve();

  get owner() {
    return this.ownerValue;
  }

  async claim(
    owner: VoiceInputOwner,
    revoke: (owner: VoiceInputOwner) => Promise<boolean>
  ): Promise<boolean> {
    let granted = false;
    const operation = this.transition.then(async () => {
      const previousOwner = this.ownerValue === owner ? null : this.ownerValue;
      if (previousOwner && !(await revoke(previousOwner))) return;
      this.ownerValue = owner;
      granted = true;
    });
    this.transition = operation.catch(() => undefined);
    await operation;
    return granted;
  }

  release(owner: VoiceInputOwner) {
    if (this.ownerValue !== owner) return false;
    this.ownerValue = null;
    return true;
  }
}
