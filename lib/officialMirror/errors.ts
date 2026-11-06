export class OfficialMirrorError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OfficialMirrorError'
  }
}
