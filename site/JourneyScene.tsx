import { useEffect, useRef, useState } from 'react'
import { CloudRain, CloudSun, LampFloor, MoonStar, Sun } from 'lucide-react'

const weatherOptions = [
  { id: 'sunny', name: '晴天', icon: Sun, caption: '每一个小小的脚步，都算数。' },
  { id: 'cloudy', name: '多云', icon: CloudSun, caption: '抬头看看，云也在陪你赶路。' },
  { id: 'rain', name: '雨天', icon: CloudRain, caption: '下雨也没关系，慢慢走就好。' },
] as const
type Weather = typeof weatherOptions[number]['id']
type Scene = NonNullable<ReturnType<typeof import('./journey/renderer').mountJourney>>

export default function JourneyScene() {
  const [state, setState] = useState({ night: false, weather: 'sunny' as Weather, reaction: 0 })
  const [live, setLive] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)
  const scene = useRef<Scene | null>(null)
  const latest = useRef(state)
  const { night, weather } = state
  const selected = weatherOptions.find(option => option.id === weather)!
  const choose = (value: Weather) => setState(prev => ({ ...prev, weather: value, reaction: prev.reaction + 1 }))
  const cycle = () => setState(prev => {
    const index = weatherOptions.findIndex(option => option.id === prev.weather)
    return { ...prev, weather: weatherOptions[(index + 1) % weatherOptions.length].id, reaction: prev.reaction + 1 }
  })
  const toggleLamp = () => setState(prev => ({ ...prev, night: !prev.night }))
  const lampAction = night ? '关闭路灯，切换白天' : '打开路灯，切换夜晚'

  useEffect(() => {
    latest.current = state
    scene.current?.update(state)
  }, [state])

  useEffect(() => {
    const surface = canvas.current!
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const connection = (navigator as Navigator & { connection?: { saveData: boolean } }).connection
    let cancelled = false
    let nearby = false
    function showPostcard() {
      setLive(false)
      scene.current?.dispose()
      scene.current = null
    }
    async function start() {
      try {
        const { mountJourney } = await import('./journey/renderer')
        if (cancelled) return
        scene.current = mountJourney(surface, latest.current, showPostcard)
        if (scene.current) setLive(true)
      } catch {
        if (!cancelled) showPostcard()
      }
    }
    function considerStarting() {
      if (!nearby || reduced.matches || connection?.saveData) return
      reduced.removeEventListener('change', considerStarting)
      observer.disconnect()
      void start()
    }
    const observer = new IntersectionObserver(([entry]) => {
      nearby = entry.isIntersecting
      considerStarting()
    }, { rootMargin: '100px' })
    reduced.addEventListener('change', considerStarting)
    observer.observe(surface)
    return () => {
      cancelled = true
      observer.disconnect()
      reduced.removeEventListener('change', considerStarting)
      scene.current?.dispose()
      scene.current = null
    }
  }, [])

  return <figure className="journey-scene" data-night={night} data-weather={weather} aria-label="背着书包，走过一座小小的庭院">
    <div className="journey-stage" data-renderer={live ? 'live' : 'postcard'}>
      <div className="journey-sky" aria-hidden="true" />
      <div className="journey-base-shadow" aria-hidden="true" />
      {!live && <img alt="" className="journey-postcard" src={`./journey/${night ? 'night' : 'day'}-${weather}.webp`} />}
      <canvas className="journey-canvas" ref={canvas} aria-hidden="true" />
      <button className="journey-hotspot cloud-hotspot" type="button" onClick={cycle}
        aria-label={`切换天气，当前${selected.name}`}><span aria-hidden="true">换个天气</span></button>
      <button className="journey-hotspot lamp-hotspot" type="button" onClick={toggleLamp} aria-pressed={night}
        aria-label={lampAction}><span aria-hidden="true">{night ? '熄灯' : '点亮路灯'}</span></button>
    </div>
    <figcaption>
      <p className="journey-caption" aria-live="polite" aria-atomic="true">
        {night && weather === 'sunny' ? '走慢一点，这盏灯会陪着你。' : selected.caption}
      </p>
      <div className="journey-controls">
        <div className="journey-weather" role="group" aria-label="天气选择">
          {weatherOptions.map(({ id, name, icon: Icon }) =>
            <button type="button" key={id} aria-pressed={id === weather} onClick={() => choose(id)}>
              <Icon size={15} aria-hidden="true" />{name}
            </button>)}
        </div>
        <button className="journey-lamp-switch" type="button" aria-pressed={night} onClick={toggleLamp} title={lampAction}>
          {night ? <MoonStar size={15} aria-hidden="true" /> : <LampFloor size={15} aria-hidden="true" />}
          {night ? '熄灯' : '点灯'}
        </button>
      </div>
      <p className="journey-hint">轻点云朵换天气，轻点路灯换昼夜</p>
    </figcaption>
  </figure>
}
