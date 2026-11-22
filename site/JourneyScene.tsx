import { useState } from 'react'

type Weather = 'sunny' | 'cloudy' | 'rain'
const weatherNames = { sunny: '晴天', cloudy: '多云', rain: '雨天' }
export default function JourneyScene() {
  const [night, setNight] = useState(false)
  const [weather, setWeather] = useState<Weather>('sunny')
  const [reaction, setReaction] = useState(0)
  const choose = (value: Weather) => { setWeather(value); setReaction(n => n + 1) }
  const cycle = () => choose(weather === 'sunny' ? 'cloudy' : weather === 'cloudy' ? 'rain' : 'sunny')
  const keyAction = (event: React.KeyboardEvent, action: () => void) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); action() }
  }
  const caption = weather === 'rain' ? '下雨也没关系，慢慢走就好。' : weather === 'cloudy' ? '抬头看看，云也在陪你赶路。' : '每一个小小的脚步，都算数。'
  return <figure className={`journey-scene ${night ? 'is-night' : 'is-day'} weather-${weather}`} aria-label="男孩背着书包走在路上的互动插画">
    <div className="journey-meta"><span>A LITTLE FURTHER, EVERY DAY</span><span>{night ? '夜晚' : '白天'} · {weatherNames[weather]}</span></div>
    <svg className="journey-art" viewBox="0 0 560 480" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="scene-halo"><stop stopColor="#fbe6a2" stopOpacity=".68"/><stop offset="1" stopColor="#fbe6a2" stopOpacity="0"/></radialGradient>
        <linearGradient id="scene-beam" x1="426" y1="160" x2="426" y2="420" gradientUnits="userSpaceOnUse"><stop stopColor="#f5d98b" stopOpacity=".3"/><stop offset="1" stopColor="#f5d98b" stopOpacity="0"/></linearGradient>
        <linearGradient id="scene-sky" x2=".5" y2="1"><stop stopColor="#eaf1ed"/><stop offset="1" stopColor="#fcfcf7"/></linearGradient>
      </defs>
      <path className="sky-wash" d="M37 265C14 143 93 57 221 49c149-10 296 61 291 202-4 119-102 181-243 179C134 428 57 375 37 265Z" fill="url(#scene-sky)"/>
      <g className="scene-stars" stroke="#e5d7a9" strokeLinecap="round">
        <path d="M127 98v10m-5-5h10M330 49v9m-4-4h8M461 93v8m-4-4h8"/><circle cx="208" cy="74" r="1"/><circle cx="360" cy="115" r="1"/><circle cx="94" cy="200" r="1"/>
      </g>
      <g className="scene-sun" stroke="#b59963" strokeWidth="1.5">
        <circle cx="160" cy="130" r="23" fill="#f0ddb2" stroke="none"/>
        <path d="M160 95v-7m0 84v-7m-35-35h-7m84 0h-7m-60-25-5-5m60 60-5-5m-50 0-5 5m60-60-5 5"/>
      </g>
      <path d="M52 381c108-18 210 12 313-8 65-12 92-16 138-8" className="scene-ground" strokeWidth="1.3" strokeLinecap="round"/>
      <path d="M88 418c75-45 118-31 181-56" className="scene-path" strokeWidth="1" strokeDasharray="3 7"/>
      <g className="footprints" fill="currentColor">
        {[{x:110,y:404,r:-35},{x:136,y:407,r:-24},{x:155,y:390,r:-30},{x:182,y:392,r:-20},{x:202,y:376,r:-25},{x:229,y:377,r:-18}].map((p,i) =>
          <g key={i} transform={`translate(${p.x} ${p.y}) rotate(${p.r})`} style={{animationDelay: `${i * .26}s`}}><ellipse rx="3" ry="6"/><circle cy="8" r="2.3"/></g>)}
      </g>
      <g className="scene-grass" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
        <path d="M88 380q-6-14-4-20m4 20q3-12 8-14M470 368q0-16-5-22m5 22q4-13 10-13M353 390q-1-10-6-12"/>
      </g>
      <ellipse cx="285" cy="374" rx="34" ry="7" className="boy-shadow"/>
      <g className="lamp-beam"><ellipse cx="428" cy="169" rx="72" ry="65" fill="url(#scene-halo)"/><path d="m416 171-87 226h190l-79-226Z" fill="url(#scene-beam)"/></g>
      <g className="street-lamp" role="button" tabIndex={0} aria-label={night ? '关闭路灯，切换白天' : '打开路灯，切换夜晚'} aria-pressed={night} onClick={() => setNight(n => !n)} onKeyDown={e => keyAction(e, () => setNight(n => !n))}>
        <title>点击路灯，切换白天与夜晚</title>
        <rect x="392" y="105" width="73" height="279" fill="transparent" stroke="none"/>
        <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M428 184v186m-13 2h26m-21-5h16M408 141l20-20 20 20m-43 0h46m-39 2 5 36h22l5-36m-29 39h26m-13-66v6"/>
          <path className="lamp-glass" d="m414 147 5 28h18l5-28Z" strokeWidth="1"/>
          <path d="M428 149v21" strokeWidth="1"/>
        </g>
        <circle className="lamp-bulb" cx="428" cy="160" r="6"/>
      </g>
      <g key={reaction} className={`boy-reaction ${reaction ? `react-${weather}` : ''}`}>
        <g className="boy-walk">
          <g stroke="#465c54" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <g className="boy-leg leg-left"><path d="m271 330-4 33" strokeWidth="12"/><path d="m266 361-7 8q8 5 18 0l-1-8" fill="#e7e3d6" strokeWidth="1.5"/></g>
            <g className="boy-leg leg-right"><path d="m295 330 5 33" strokeWidth="12"/><path d="m301 361 8 8q-7 5-18 1l1-9" fill="#e7e3d6" strokeWidth="1.5"/></g>
            <path d="m263 277-12 37q0 8 7 6l13-29m29-14 15 37q2 6-4 7l-14-23" fill="#eee9dc" strokeWidth="1.5"/>
            <path d="M269 267q14-7 29 0l9 64q-24 11-48 0Z" fill="#e9e6d9" strokeWidth="1.6"/>
            <path d="M272 271q-8 23-5 45m29-44q8 17 6 40" stroke="#8c9e8d" strokeWidth="4"/>
            <path d="M269 281q15-9 29 1l6 37q-17 12-39 0Z" fill="#93a995" strokeWidth="1.6"/>
            <path d="M274 303q11-4 23 0v16q-12 5-23 0Z" fill="#a8b7a0" strokeWidth="1.2"/>
            <path d="M279 278v-6h12v6m-12 33h11" strokeWidth="1.2"/>
          </g>
          <g className="boy-head" stroke="#465c54" strokeWidth="1.6" strokeLinejoin="round">
            <path d="M277 259v10q8 6 15-1v-10" fill="#d9bca1"/>
            <path d="M263 242q-5-32 22-32 29 0 24 33l-4 15q-19 18-36-2Z" fill="#40504a"/>
            <path d="M262 244q-6-26 12-34 16-8 29 7 12 8 6 30l-7-2-3-14q-16 14-30 3l-2 11Z" fill="#40504a"/>
            <path d="M269 218q10-8 21-1m-21 5q8-5 13-3" stroke="#657368" strokeWidth="1"/>
          </g>
          <g className="boy-umbrella" stroke="#465c54" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M316 185v121q0 12-9 6"/>
            <path d="M316 137q-45 1-57 45 13-9 27 0 15-10 30 0 16-10 29 0 16-10 29 0-12-44-58-45Z" fill="#c4caba"/>
            <path d="M316 137q-22 11-30 45m30-45q23 11 29 45m-29-51v6" stroke="#758577" strokeWidth="1"/>
            <path d="m313 308 2-3" stroke="#d9bca1" strokeWidth="7"/>
          </g>
        </g>
      </g>
      <g className="scene-rain" stroke="#8caaad" strokeWidth="1.4" strokeLinecap="round">
        {Array.from({length: 14},(_,i) => <path key={i} d={`m${124 + (i * 37) % 245} ${180 + (i * 43) % 170} -4 12`} style={{animationDelay:`${-i * .19}s`}}/>)}
      </g>
      <g className="scene-cloud" role="button" tabIndex={0} aria-label={`切换天气，当前${weatherNames[weather]}`} onClick={cycle} onKeyDown={e => keyAction(e, cycle)}>
        <title>点击云朵，切换晴天、多云、雨天</title>
        <rect x="192" y="62" width="150" height="100" fill="transparent" stroke="none"/>
        <path d="M215 139q-23-1-22-20 1-17 20-19 8-27 36-23 23 1 30 24 24-11 38 7 16 27-12 31Z" fill="currentColor" strokeWidth="1.2"/>
        <path d="M220 130q12 3 23 0m35 1h12" strokeWidth="1" fill="none"/>
      </g>
      <text x="414" y="405" className="scene-hint">点亮一下</text>
    </svg>
    <figcaption className="journey-caption" aria-live="polite">{caption}</figcaption>
    <div className="weather-controls" aria-label="天气选择">
      {(['sunny', 'cloudy', 'rain'] as const).map(w => <button type="button" key={w} aria-pressed={weather === w} onClick={() => choose(w)}>{weatherNames[w]}</button>)}
      <span>轻触云朵，换一种心情</span>
    </div>
  </figure>
}

