import * as T from 'three'
import { group, seeded } from './clay'

// Blend the puffs into one surface so that each cloud has a soft, continuous underside.
function cloudShape(k) {
  const shape = k.geometry(new T.SphereGeometry(1,64,32))
  const lobes=[[-.57,-.075,.015,.235,.19,.218],[-.37,.027,.02,.256,.270,.255],[.018,.101,-.025,.32,.315,.287],
    [.323,.041,.04,.228,.245,.227],[.533,-.074,0,.238,.169,.209],[-.04,-.104,.088,.528,.140,.249]]
  function field(x,y,z) {
    let d=10
    for(const [cx,cy,cz,a,b,c] of lobes) {
      const e=(Math.hypot((x-cx)/a,(y-cy)/b,(z-cz)/c)-1)*Math.min(a,b,c)
      const h=Math.max(.060-Math.abs(d-e),0)
      d=Math.min(d,e)-h*h/(4*.060)
    }
    return d
  }
  const p=shape.attributes.position, n=shape.attributes.normal
  const normal=new T.Vector3(), delta=.002
  for(let i=0;i<p.count;i++) {
    const vx=p.getX(i), vy=p.getY(i), vz=p.getZ(i)
    let lo=0,hi=1.1
    for(let step=0;step<13;step++) {
      const r=(lo+hi)/2
      if(field(vx*r,vy*r,vz*r)<0) lo=r
      else hi=r
    }
    const x=vx*lo,y=vy*lo,z=vz*lo
    p.setXYZ(i,x,y,z)
    normal.set(field(x+delta,y,z)-field(x-delta,y,z),field(x,y+delta,z)-field(x,y-delta,z),field(x,y,z+delta)-field(x,y,z-delta)).normalize()
    n.setXYZ(i,normal.x,normal.y,normal.z)
  }
  return shape
}

function crescent(k,scene) {
  const outline=new T.Shape()
  outline.moveTo(.108,.282)
  outline.bezierCurveTo(-.079,.10,-.026,-.105,.205,-.154)
  outline.bezierCurveTo(.031,-.382,-.306,-.252,-.302,.004)
  outline.bezierCurveTo(-.300,.213,-.084,.362,.108,.282)
  const shape=k.geometry(new T.ExtrudeGeometry(outline,{depth:.074,bevelThickness:.024,bevelSize:.023,bevelSegments:3,curveSegments:24}))
  const mat=k.material(new T.MeshStandardMaterial({color:'#f8e9bf',emissive:'#f6d496',emissiveIntensity:.72}))
  const moon=k.mesh(scene,shape,mat,-1.59,3.49,-1.14)
  moon.rotation.set(-.03,-.1,-.26)
  moon.castShadow=false
  return moon
}

function makeRain(k,scene) {
  const random=seeded(42311)
  const drops=Array.from({length:46},()=>({
    x:(random()-.5)*4.48,z:(random()-.5)*1.93,phase:random(),length:.095+random()*.10,speed:.64+random()*.40
  }))
  const shape=k.geometry(new T.BufferGeometry())
  const p=new T.Float32BufferAttribute(new Float32Array(drops.length*6),3)
  p.setUsage(T.DynamicDrawUsage); shape.setAttribute('position',p)
  const rain=k.material(new T.LineBasicMaterial({color:'#8daba9',transparent:true,opacity:.69,depthWrite:false}))
  const streaks=new T.LineSegments(shape,rain)
  streaks.frustumCulled=false; scene.add(streaks)
  const rippleMat=k.material(new T.MeshBasicMaterial({color:'#e7edda',transparent:true,opacity:.85,depthWrite:false}))
  const ring=k.geometry(new T.RingGeometry(.09,.105,28))
  const ripples=[[-.9,1.16],[.7,-.80],[1.12,.52],[-.28,.79]].map(([x,z])=>{
    const mesh=k.mesh(scene,ring,rippleMat,x,.036,z)
    mesh.rotation.x=-Math.PI/2; mesh.castShadow=mesh.receiveShadow=false
    return mesh
  })
  return (time,amount) => {
    const wet=amount>.015
    streaks.visible=wet
    ripples.forEach(m=>{m.visible=wet})
    if(!wet) return
    rain.opacity=amount*.72; rippleMat.opacity=amount*.82
    drops.forEach(({x,z,phase,length,speed},i)=>{
      const t=(time*speed*.58+phase)%1, height=3.15
      const y=.065+(1-t)*height, drift=x-t*.47
      p.setXYZ(i*2,drift,y,z); p.setXYZ(i*2+1,drift+.021,y+length,z)
    })
    p.needsUpdate=true
    ripples.forEach((m,i)=>m.scale.setScalar(.4+((time*.82+i*.27)%1)*1.12))
  }
}

export function createSky(k,scene,spot) {
  const cloudMat=k.material(new T.MeshStandardMaterial({color:'#fffaed',roughness:1}))
  const cloudGeo=cloudShape(k)
  const cloud=k.mesh(scene,cloudGeo,cloudMat,-.24,3.59,-.78)
  cloud.scale.setScalar(1.17); cloud.castShadow=false
  const companion=k.mesh(scene,cloudGeo,cloudMat,1.57,3.48,-1.53)
  companion.rotation.y=.33; companion.castShadow=false
  const sun=k.oval(scene,k.material(new T.MeshStandardMaterial({color:'#f7cf85',emissive:'#edaf5b',emissiveIntensity:.36,roughness:1,transparent:true})),
    -1.61,3.42,-1.15,.314,.314,.31)
  sun.castShadow=false
  const aureole=k.material(new T.SpriteMaterial({map:spot,color:'#ffe6a7',transparent:true,opacity:.53,depthWrite:false}))
  const halo=new T.Sprite(aureole); halo.scale.setScalar(1.49); halo.position.copy(sun.position); halo.position.z-=.12; scene.add(halo)
  const moon=crescent(k,scene)
  const fireflies=group(scene)
  const ember=k.material(new T.SpriteMaterial({map:spot,color:'#ffda96',transparent:true,depthWrite:false}))
  const lights=[[.98,1.16,.36],[1.99,1.54,-.36],[1.37,.53,.65],[-1.32,.78,.48]].map(([x,y,z])=>{
    const light=new T.Sprite(ember)
    light.position.set(x,y,z); fireflies.add(light)
    return {light,x,y}
  })
  const stars=group(scene)
  for(const [x,y,z,s] of [[-2.35,3.34,-1,.059],[-1.92,3.97,-.8,.035],[-.88,3.86,-1.07,.05],[.73,4.13,-.68,.041],[1.34,3.87,-.75,.058],[2.19,3.25,-1.05,.033],[.85,3.04,-1.45,.031]]) {
    k.oval(stars,'#ffe7b1',x,y,z,s*.3,s,.015)
    k.oval(stars,'#ffe7b1',x,y,z,s,s*.30,.015)
  }
  const points=k.bake(stars)
  points.material=k.material(new T.MeshBasicMaterial({color:'#ffeec6',transparent:true,depthWrite:false}))
  points.castShadow=false
  const rain=makeRain(k,scene)
  const dayCloud=new T.Color('#fff7e7'), greyCloud=new T.Color('#abbdc0'), nightCloud=new T.Color('#94a9ba')
  return function updateSky(time, night, overcast, wet) {
    cloud.position.y=3.59+.041*Math.sin(time*.83)
    cloud.position.x=-.24+.077*Math.sin(time*.47)
    cloud.rotation.z=.019*Math.sin(time*.52)
    const puffScale=1.10+.16*overcast
    cloud.scale.set(puffScale,puffScale*(1+.07*overcast),puffScale)
    cloudMat.color.copy(dayCloud).lerp(greyCloud,overcast*.89).lerp(nightCloud,night*.61)
    companion.scale.setScalar(.42+.29*overcast)
    companion.position.x=1.63+.054*Math.cos(time*.43)
    companion.position.y=3.42+.037*Math.sin(time*.71)
    const clear=1-overcast*.67
    const sunlight=(1-night)*clear*(1-wet), moonlight=night*(1-.95*wet)
    sun.visible=halo.visible=sunlight>.04
    sun.position.x=-1.61+overcast*1.26
    sun.material.opacity=sunlight
    halo.position.x=sun.position.x
    aureole.opacity=.58*sunlight
    moon.visible=moonlight>.10; moon.scale.setScalar(Math.max(.012,night))
    fireflies.visible=night*(1-wet)>.10
    if(fireflies.visible) lights.forEach(({light,x,y},i)=>{
      light.position.x=x+.070*Math.sin(time*.58+i*2)
      light.position.y=y+.095*Math.sin(time*.72+i*3)
      light.scale.setScalar((.08+.04*Math.sin(time*1.1+i))*night*(1-wet))
    })
    stars.visible=night*(1-wet)>.12
    points.material.opacity=night*(1-wet)
    rain(time,wet)
  }
}
