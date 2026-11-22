import * as T from 'three'
import { Clay, softSpot } from './clay'
import { createGarden, createLamp } from './garden'
import { createSky } from './sky'
import { createStudent } from './student'

const overcastFor = { sunny: 0, cloudy: .64, rain: 1 }

export function mountJourney(canvas, initial, onLoss) {
  const gl = canvas.getContext('webgl2', {alpha:true, antialias:true, powerPreference:'low-power', premultipliedAlpha:true})
  if (!gl) return null
  const renderer = new T.WebGLRenderer({canvas,context:gl,alpha:true,antialias:true})
  renderer.setClearColor(0x000000,0)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = T.PCFShadowMap
  renderer.shadowMap.autoUpdate = false
  renderer.toneMapping = T.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.10

  const scene=new T.Scene(), k=new Clay(), spot=softSpot(k)
  const eye=new T.OrthographicCamera(-4,4,3,-3,.1,45)
  eye.position.set(0,6.71,12)
  eye.lookAt(0,1.73,0)
  const fill=new T.HemisphereLight('#fff3dd','#c1b099',1.84)
  const key=new T.DirectionalLight('#ffe5bb',2.42)
  key.position.set(-3.6,7.4,4.3)
  key.castShadow=true
  key.shadow.mapSize.set(1024,1024)
  Object.assign(key.shadow.camera,{left:-4.5,right:4.5,bottom:-3.5,top:4.4,near:.5,far:16})
  key.shadow.camera.updateProjectionMatrix()
  key.shadow.normalBias=.022; key.shadow.bias=-.00045; key.shadow.radius=3
  const rim=new T.DirectionalLight('#fff2d0',1.13)
  rim.position.set(2.5,4.1,-4.8); scene.add(fill,key,rim)

  const prints=createGarden(k,scene), lamp=createLamp(k,scene,spot)
  const pose=createStudent(k,scene), sky=createSky(k,scene,spot)
  const contact=k.material(new T.MeshBasicMaterial({map:spot,color:'#655740',transparent:true,opacity:.30,depthWrite:false}))
  const shadow=k.mesh(scene,k.geometry(new T.PlaneGeometry(.97,.65)),contact,.07,.034,.17)
  shadow.rotation.x=-Math.PI/2; shadow.castShadow=shadow.receiveShadow=false

  const stage=canvas.parentElement
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)')
  const dayFill=new T.Color('#fff3dd'), duskFill=new T.Color('#b2cae2'), greyFill=new T.Color('#d9e2e0')
  const dayKey=new T.Color('#ffe5bb'), nightKey=new T.Color('#a6bee4'), greyKey=new T.Color('#ebeee8')
  let state=initial, night=Number(state.night), grey=overcastFor[state.weather], wet=Number(state.weather==='rain')
  let elapsed=.97, reaction=initial.reaction ? 0 : 99, visible=true, stopped=false, frame=0, lastFrame=0, lastShadow=-Infinity
  let targetX=0, targetY=0, offsetX=0, offsetY=0

  function draw(now) {
    frame=0
    if(stopped || !visible || document.hidden) return
    const still=reduced.matches
    if(!still && lastFrame && now-lastFrame < 1000/30-1) { schedule(); return }
    const delta=lastFrame ? Math.min(.10,(now-lastFrame)/1000) : 0
    lastFrame=now
    const blend=still ? 1 : 1-Math.exp(-delta*5.2)
    night+=(Number(state.night)-night)*blend
    grey+=(overcastFor[state.weather]-grey)*blend
    wet+=(Number(state.weather==='rain')-wet)*blend
    if(!still) { elapsed+=delta; reaction+=delta }
    const t=still ? .97 : elapsed
    offsetX+=((still?0:targetX)-offsetX)*blend
    offsetY+=((still?0:targetY)-offsetY)*blend
    eye.position.set(offsetX*.29,6.71+offsetY*.14,12)
    eye.lookAt(0,1.73,0)
    fill.color.copy(dayFill).lerp(greyFill,grey).lerp(duskFill,night)
    key.color.copy(dayKey).lerp(greyKey,grey).lerp(nightKey,night)
    fill.intensity=T.MathUtils.lerp(1.80-.23*grey,1.10-.09*grey,night)
    key.intensity=T.MathUtils.lerp(2.36-.72*grey,1.03-.15*grey,night)
    rim.intensity=T.MathUtils.lerp(1.06-.25*grey,.95,night)
    key.shadow.intensity=.65-.23*grey
    lamp(night); sky(t,night,grey,wet); pose(t,state.weather,reaction,still)
    const jump=state.weather==='sunny' && !still ? Math.sin(Math.PI*Math.min(1,reaction/1.30))**2 : 0
    shadow.scale.setScalar(1+jump*.27); contact.opacity=.32-jump*.14
    prints.forEach((print,i)=>{
      const pressure=still ? 1 : .91+.09*Math.sin(t*2.4-i*.91)
      print.scale.set(pressure,1,pressure)
    })
    if(still || now-lastShadow>=100) {
      lastShadow=now
      renderer.shadowMap.needsUpdate=true
    }
    renderer.render(scene,eye)
    if(!still) schedule()
  }
  function schedule() {
    if(!frame && !stopped && visible && !document.hidden) frame=requestAnimationFrame(draw)
  }
  function restart() {
    cancelAnimationFrame(frame); frame=0; lastFrame=0; schedule()
  }
  function resize() {
    const w=canvas.clientWidth, h=canvas.clientHeight
    if(!w || !h) return
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1,1.65))
    renderer.setSize(w,h,false)
    eye.left=-3.91; eye.right=3.91
    eye.top=3.91*h/w; eye.bottom=-eye.top
    eye.updateProjectionMatrix()
    restart()
  }
  function move(e) {
    if(e.pointerType!=='mouse' || reduced.matches) return
    const rect=stage.getBoundingClientRect()
    targetX=2*(e.clientX-rect.left)/rect.width-1
    targetY=1-2*(e.clientY-rect.top)/rect.height
  }
  function resetPointer() { targetX=targetY=0 }
  const dimensions=new ResizeObserver(resize)
  const inView=new IntersectionObserver(([entry])=>{ visible=entry.isIntersecting; restart() })
  dimensions.observe(stage); inView.observe(stage)
  reduced.addEventListener('change',restart)
  document.addEventListener('visibilitychange',restart)
  stage.addEventListener('pointermove',move,{passive:true}); stage.addEventListener('pointerleave',resetPointer)
  canvas.addEventListener('webglcontextlost',onLoss)
  resize()
  // Present the first pose before the UI takes down its illustrated cover.
  cancelAnimationFrame(frame); frame=0; draw(performance.now())

  return {
    update(next) {
      if(next.reaction!==state.reaction) reaction=0
      state=next; schedule()
    },
    dispose() {
      stopped=true; cancelAnimationFrame(frame)
      dimensions.disconnect(); inView.disconnect()
      reduced.removeEventListener('change',restart)
      document.removeEventListener('visibilitychange',restart)
      stage.removeEventListener('pointermove',move); stage.removeEventListener('pointerleave',resetPointer)
      canvas.removeEventListener('webglcontextlost',onLoss)
      key.shadow.dispose(); k.dispose(); renderer.dispose()
      if(!gl.isContextLost()) gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
}
