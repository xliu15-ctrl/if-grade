import * as T from 'three'
import { group, paintedTexture, seeded } from './clay'

const rx = 3.17, rz = 1.88
function pathX(z) { return .11-.70*z+.30*Math.sin(2.25*z) }

function groundTexture(k) {
  return paintedTexture(k, 896, 560, (ctx, w, h) => {
    const random = seeded(3162)
    const px = x => (.5+x/(2*rx))*w, py = z => (.5+z/(2*rz))*h
    const meadow = ctx.createLinearGradient(0,0,w,h)
    meadow.addColorStop(0,'#a5b58c'); meadow.addColorStop(.55,'#bcc79b'); meadow.addColorStop(1,'#cbd2a7')
    ctx.fillStyle = meadow
    ctx.fillRect(0,0,w,h)
    const trail = new Path2D()
    function edge(z, side) { return pathX(z)+side*(.58+.12*z+.035*Math.cos(5*z)) }
    for (let i=0; i<=80; i++) {
      const z = -rz+i*rz/40
      if (i === 0) trail.moveTo(px(edge(z,-1)),py(z))
      else trail.lineTo(px(edge(z,-1)),py(z))
    }
    for (let i=80; i>=0; i--) {
      const z = -rz+i*rz/40
      trail.lineTo(px(edge(z,1)),py(z))
    }
    trail.closePath()
    ctx.strokeStyle = '#b4b18f'; ctx.lineWidth = 5; ctx.stroke(trail)
    const sand = ctx.createLinearGradient(0,h,w,0)
    sand.addColorStop(0,'#e0c5a2'); sand.addColorStop(.55,'#efdab9'); sand.addColorStop(1,'#decaab')
    ctx.fillStyle = sand; ctx.fill(trail)
    for (let i=0; i<3300; i++) {
      const x = random()*w, y = random()*h
      ctx.fillStyle = random()>.47 ? 'rgba(255,252,224,.24)' : 'rgba(88,81,59,.13)'
      ctx.beginPath(); ctx.ellipse(x,y,.45+random()*2.0,.4+random()*1.2, random()*3,0,2*Math.PI); ctx.fill()
    }
    // Painted contact shadows soften the joins of the little bench, tree and lamp.
    for (const [x,z,sx,sz] of [[-2.04,-.55,.80,.48],[-1.89,.31,.66,.32],[1.72,-.38,.43,.29],[2.33,.58,.42,.25]]) {
      ctx.save()
      ctx.translate(px(x),py(z)); ctx.scale(w*sx/(2*rx),h*sz/(2*rz))
      const shade = ctx.createRadialGradient(0,0,.03,0,0,1)
      shade.addColorStop(0,'rgba(70,76,54,.38)'); shade.addColorStop(1,'rgba(70,76,54,0)')
      ctx.fillStyle=shade; ctx.fillRect(-1,-1,2,2); ctx.restore()
    }
  })
}

function tree(k, parent, x, z, size) {
  const trunk = '#9a7956', leaf = '#8fa989'
  const crown = group(parent,x,0,z)
  crown.scale.setScalar(size)
  k.turned(crown,trunk, [[.145,0],[.122,.13],[.080,.50],[.060,1.03],[.027,1.58]], 0,0,0,16)
  k.stroke(crown,trunk, [[0,.55,0],[-.13,.81,.004],[-.32,1.05,.01],[-.4,1.31,.02]],.052)
  k.stroke(crown,'#ad8c67', [[.004,.77,-.018],[.19,.98,-.03],[.31,1.25,-.03]],.042)
  const grove = [
    [-.32,1.42, .015,.37,.55,.35,-.29,'#91ab87'],
    [.32,1.56,-.08,.36,.53,.35,.30,'#8aa883'],
    [-.03,1.87,-.10,.442,.67,.391,-.12,leaf],
    [.12,2.15,-.11,.292,.46,.299,.12,'#a0b690'],
    [-.18,1.63, .20,.30,.425,.25,-.32,'#a2b995'],
  ]
  for (const [bx,by,bz,a,b,c,tilt,col] of grove) {
    k.oval(crown,col,bx,by,bz,a,b,c).rotation.z=tilt
  }
  for (const [bx,by,bz,tilt] of [[-.33,1.62,.339,-.6],[-.26,1.72,.351,-.65],[.17,2.24,.167,.4],[.23,2.14,.176,.45],[.19,1.60,.288,.35]]) {
    k.oval(crown,'#b6c6a0',bx,by,bz,.028,.060,.008).rotation.z=tilt
  }
}

function bench(k,parent) {
  const bench = group(parent,-1.91,.005,.36)
  bench.rotation.y = .70
  for (const x of [-.43,.43]) {
    for (const z of [-.138,.138]) k.box(bench,'#61766b',x,.151,z,.062,.295,.065,.018)
    k.box(bench,'#65786b',x,.38,-.143,.055,.44,.058,.017).rotation.x=-.08
    k.box(bench,'#748479',x,.263,0,.074,.067,.39,.019)
  }
  for (const z of [-.125,0,.125]) k.box(bench,'#be9064',0,.307,z,1.13,.078,.109,.028)
  for (const y of [.459,.602]) {
    k.box(bench,'#cf9f6f',0,y,-.15,1.14,.112,.060,.025)
    for (const x of [-.428,.428]) k.oval(bench,'#8b775c',x,y,-.116,.015,.015,.008)
  }
}

function flowers(k, parent, x, z, count, random) {
  const stem = '#7b8e66'
  for (let i=0; i<count; i++) {
    const bx=x+(random()-.5)*.57, bz=z+(random()-.5)*.32
    const h=.105+random()*.11, angle=random()*Math.PI
    k.oval(parent,stem,bx,h*.52,bz,.011,h*.53,.012)
    const colour = i%4===0 ? '#e8ab84' : '#fff1ce'
    for (let j=0;j<5;j++) {
      const a=j*2*Math.PI/5+angle
      k.oval(parent,colour,bx+.047*Math.cos(a),h+.025*Math.sin(a),bz+.030*Math.sin(a),.040,.031,.035)
    }
    k.oval(parent,'#d5a252',bx,h+.008,bz+.026,.028,.025,.031)
  }
}

function greenery(k,parent) {
  const random=seeded(851), foliage=['#a6b48a','#839c7f','#b9c29a','#9aad86']
  tree(k,parent,-2.10,-.62,.91)
  bench(k,parent)
  for (const [x,z,s] of [[-2.50,-.13,.42],[-1.48,-.88,.42],[2.23,-.55,.47],[2.53,-.03,.32],[2.10,1.00,.25]]) {
    for(let i=0;i<4;i++) {
      const a=i*2.40, h=s*(.75+.23*i)
      k.oval(parent,foliage[i],x+Math.sin(a)*s*.47,h*.48,z+Math.cos(a)*s*.27,s*(.44+.06*i),h*.63,s*.47).rotation.z=Math.sin(a)*.38
    }
  }
  for (const [x,z] of [[-2.64,.48],[-1.45,.81],[2.03,.28],[1.17,1.30],[.07,1.57],[2.31,-.23],[-.78,-1.18],[-2.05,1.03],[-.15,-1.17]]) {
    for(let i=0;i<4;i++) {
      const angle=i*1.68, h=.12+random()*.19
      const blade=k.oval(parent,foliage[i],x+.063*Math.sin(angle),h/2,z+.052*Math.cos(angle),.035,h*.53,.028)
      blade.rotation.z=-Math.sin(angle)*.58; blade.rotation.x=Math.cos(angle)*.53
    }
  }
  for(const [x,z,s] of [[-2.27,.85,.19],[-2.46,.68,.121],[1.57,1.13,.145],[1.78,1.07,.09],[2.51,.45,.21],[-.92,-1.20,.12]]) {
    k.oval(parent,'#b1ad94',x,.057,z,s,s*.56,s*.81).rotation.y=x
  }
  flowers(k,parent,-1.26,.90,4,random)
  flowers(k,parent,1.13,1.02,4,random)
  flowers(k,parent,2.26,.37,4,random)
  flowers(k,parent,-2.49,.39,3,random)
  k.bake(parent)
}

export function createGarden(k, scene) {
  // The cross-section remains rounded at the rim, like a hand-painted wooden model.
  for(const [col,profile] of [
    ['#bd9c78',[[0,-.40],[.89,-.40],[.94,-.377],[.969,-.312],[.972,-.24]]],
    ['#e5c9a3',[[.949,-.335],[.975,-.298],[.984,-.27],[.99,-.182],[.985,-.15]]],
    ['#a9b390',[[.982,-.205],[.995,-.166],[1,-.117],[.996,-.076],[.980,-.028],[.961,-.004]]],
  ]) {
    k.turned(scene,col,profile,0,0,0,96).scale.set(rx,1,rz)
  }
  const meadow = k.material(new T.MeshStandardMaterial({map:groundTexture(k),roughness:.98}))
  const top = k.mesh(scene,k.geometry(new T.CircleGeometry(1,96)),meadow)
  top.rotation.x=-Math.PI/2
  top.scale.set(rx*.963,rz*.963,1)
  const plants=group(scene)
  greenery(k,plants)
  const sole=new T.Shape()
  sole.moveTo(-.049,-.011)
  sole.bezierCurveTo(-.076,.034,-.069,.111,-.021,.130)
  sole.bezierCurveTo(.042,.147,.083,.083,.062,.029)
  sole.bezierCurveTo(.046,-.005,.012,-.029,-.049,-.011)
  const heel=new T.Shape()
  heel.moveTo(-.048,-.045)
  heel.bezierCurveTo(-.065,-.109,-.024,-.125,.020,-.113)
  heel.bezierCurveTo(.051,-.104,.055,-.064,.04,-.039)
  heel.lineTo(-.048,-.045)
  const tread=k.geometry(new T.ShapeGeometry([sole,heel],12))
  const steps=[]
  for (let i=0;i<7;i++) {
    const z=1.62-i*.202, side=i%2===0 ? -1:1
    const print=group(scene,pathX(z)+side*.11,.013,z)
    print.rotation.y=Math.atan2(.7-.675*Math.cos(2.25*z),-1)+Math.PI + side*.07
    // Two pressed shapes per shoe. A lighter lip catches the light at the edge of the impression.
    for (const [col,y,scale] of [['#efd8b0',.001,1.14],['#a58260',.005,1]]) {
      const stamp=k.mesh(print,tread,col,0,y,0)
      stamp.rotation.x=-Math.PI/2
      stamp.scale.setScalar(scale)
    }
    k.bake(print).castShadow=false
    steps.push(print)
  }
  return steps
}

export function createLamp(k, scene, spotTexture) {
  const lamp=group(scene,1.72,.012,-.38), solid=group(lamp)
  const iron='#48665e', dark='#3f5852', brass='#b39a66'
  k.turned(solid,'#b8b19b',[[.235,0],[.244,.044],[.232,.090],[.193,.112]],0,0,0,32)
  k.turned(solid,iron,[[.165,.085],[.171,.132],[.145,.157],[.122,.189],[.122,.32],[.103,.374],[.088,.40],[.070,.52],[.054,2.29],[.091,2.33],[.088,2.40],[.137,2.45]],0,0,0,32)
  for(const [y,r,h] of [[.17,.138,.041],[.41,.091,.035],[.55,.072,.028],[2.23,.073,.052],[2.39,.109,.042]]) {
    k.turned(solid,brass,[[r*.87,y],[r,y+.008],[r,y+h-.008],[r*.88,y+h]])
  }
  k.turned(solid,dark,[[.09,2.416],[.211,2.463],[.201,2.504],[.160,2.520]],0,0,0,6)
  k.turned(solid,brass,[[.088,2.50],[.084,2.54],[.058,2.56],[.046,2.63]],0,0,0,16)
  for(let i=0;i<6;i++) {
    const a=i*Math.PI/3
    k.stroke(solid,iron,[[.167*Math.sin(a),2.486,.167*Math.cos(a)],[.251*Math.sin(a),2.979,.251*Math.cos(a)]],.018)
  }
  k.turned(solid,iron,[[.23,2.961],[.277,2.982],[.307,3.017],[.294,3.048],[.245,3.066],[.133,3.183],[.082,3.272],[.045,3.28]],0,0,0,6)
  k.turned(solid,brass,[[.295,3.018],[.298,3.034],[.287,3.041]],0,0,0,6)
  k.turned(solid,dark,[[.04,3.267],[.064,3.296],[.062,3.33],[.034,3.367],[0,3.414]])
  k.bake(solid)

  const glass=k.material(new T.MeshStandardMaterial({color:'#eddfb9',emissive:'#f6b66b',emissiveIntensity:.05,roughness:.42,transparent:true,opacity:.45,depthWrite:false}))
  k.turned(lamp,glass,[[.152,2.494],[.235,2.972]],0,0,0,6)
  const bulb=k.material(new T.MeshStandardMaterial({color:'#f8dfaa',emissive:'#ffc06d',roughness:.36}))
  k.oval(lamp,bulb,0,2.701,0,.068,.134,.068).castShadow=false
  const warm=k.material(new T.SpriteMaterial({map:spotTexture,color:'#ffbf73',transparent:true,opacity:0,depthWrite:false,blending:T.AdditiveBlending}))
  const glow=new T.Sprite(warm)
  glow.position.set(0,2.746,.09); glow.scale.setScalar(1.42); lamp.add(glow)
  const spill=k.material(new T.MeshBasicMaterial({map:spotTexture,color:'#ffca83',transparent:true,opacity:0,depthWrite:false}))
  const pool=k.mesh(scene,k.geometry(new T.PlaneGeometry(2.25,1.57)),spill,1.49,.031,-.16)
  pool.rotation.x=-Math.PI/2; pool.castShadow=pool.receiveShadow=false
  const light=new T.PointLight('#ffc278',0,3.8,2)
  light.position.set(1.64,2.62,-.03); scene.add(light)
  return night => {
    glass.emissiveIntensity=.05+night*.82; bulb.emissiveIntensity=.09+night*2.35
    warm.opacity=night*.64; spill.opacity=night*.37; light.intensity=night*4.8
  }
}
