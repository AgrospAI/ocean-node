import { expect } from 'chai'
import sinon from 'sinon'
import { C2DEngineDocker } from '../../components/c2d/compute_engine_docker.js'

describe('compute loop timer', () => {
  it('allows rescheduling after a timer fires during an active pass', async () => {
    const clock = sinon.useFakeTimers()
    const engine: any = Object.create(C2DEngineDocker.prototype)
    engine.envs = [{}]
    engine.cronTime = 2000
    engine.stopped = false
    engine.isInternalLoopRunning = true
    engine.getC2DConfig = () => ({ hash: 'test' })
    try {
      engine.setNewTimer()
      await clock.tickAsync(2000)
      await engine.internalLoopPromise
      expect(engine.cronTimer).to.equal(null)

      // The original pass finishes and must be able to schedule the next tick.
      engine.isInternalLoopRunning = false
      engine.setNewTimer()
      expect(engine.cronTimer).to.not.equal(null)
    } finally {
      clock.restore()
    }
  })
})
