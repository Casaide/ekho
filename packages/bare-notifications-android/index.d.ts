import EventEmitter from 'bare-events'

interface Notifications extends EventEmitter {
  readonly granted: boolean
  ready(channel?: string): void
  request(): Promise<boolean>
  show(id: number, opts: { title: string; body?: string }): void
  cancel(id?: number): void
  on(event: 'open', listener: (id: number) => void): this
  on(event: 'permission', listener: (granted: boolean) => void): this
}

declare const notifications: Notifications

export = notifications
