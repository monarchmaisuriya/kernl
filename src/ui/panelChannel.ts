/**
 * Delivery to the webview. Messages go out only while a webview is attached and has said it is
 * ready; anything else is dropped, because the host re-sends the full state (status, run state,
 * open approval cards) every time a webview becomes ready. No unbounded queue.
 */
export class PanelChannel<T> {
  private deliver: ((message: T) => void) | undefined;
  private ready = false;

  /** A new webview exists but its script has not loaded yet. */
  attach(deliver: (message: T) => void) {
    this.deliver = deliver;
    this.ready = false;
  }

  detach() {
    this.deliver = undefined;
    this.ready = false;
  }

  markReady() {
    this.ready = this.deliver !== undefined;
  }

  /** True when a webview is attached and listening. */
  get isReady(): boolean {
    return this.ready;
  }

  /** Returns whether the message was delivered. */
  post(message: T): boolean {
    if (!this.deliver || !this.ready) return false;
    this.deliver(message);
    return true;
  }
}
