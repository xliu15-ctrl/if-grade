import * as T from 'three'
import { group } from './clay'

const hair = '#49372e', lock = '#564035', skin = '#efba94'
const knit = '#f1e4c9', rib = '#ddd0ac', teal = '#506d65', leather = '#a96339'

function makeHead(k, body) {
  const head = group(body, 0, 1.56, -.035)
  k.oval(head, skin, 0, .32, -.015, .425, .425, .382)
  for (const side of [-1, 1]) {
    k.oval(head, skin, side*.408, .27, -.004, .077, .111, .08)
    k.oval(head, '#db997e', side*.455, .272, 0, .032, .059, .049)
    k.oval(head, '#503932', side*.145, .32, -.365, .033, .052, .023)
    k.oval(head, '#fff2d7', side*.145-.008, .339, -.384, .009, .011, .006)
    k.oval(head, '#e7a28b', side*.239, .241, -.323, .058, .026, .017)
  }
  k.oval(head, skin, 0, .255, -.391, .043, .042, .04)
  k.stroke(head, '#986450', [[-.056,.194,-.36], [0,.174,-.368], [.055,.194,-.36]], .009)

  // The hairline is higher over the eyes and scalloped at the nape.
  function hairPoint(angle, theta, lift = 0) {
    const sin = Math.sin(theta), swell = 1+.039*Math.cos(5*angle+1.6*theta)*sin
    return [(.457*swell+lift)*sin*Math.sin(angle), .375+(.454+lift)*Math.cos(theta), (.409*swell+lift)*sin*Math.cos(angle)]
  }
  const cap = k.geometry(new T.SphereGeometry(1, 64, 32))
  const p = cap.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i)
    const angle = Math.atan2(x, z)
    const t = Math.acos(T.MathUtils.clamp(p.getY(i), -1, 1)) / Math.PI
    const hem = 1.68 + .47*Math.cos(angle) + .072*Math.sin(7*angle) + .054*Math.cos(4*angle)
    const theta = t * hem
    p.setXYZ(i, ...hairPoint(angle,theta))
  }
  cap.computeVertexNormals()
  k.mesh(head, cap, hair)
  // Swept, tapered locks sit on the same surface as the cap, including around the back.
  for (const [angle, end, colour] of [[-1.18,1.70,lock],[-.63,1.94,'#533e32'],[-.08,1.77,'#593f31'],
    [.58,1.69,'#513c31'],[1.23,1.70,lock],[1.94,1.39,lock],[-2.23,1.47,lock]]) {
    const positions=[], indices=[]
    for(let i=0;i<=18;i++) {
      const t=i/18, taper=Math.sin(Math.PI*t)**.68
      const a=angle+.9*(1-t)**1.55, theta=.32+(end-.32)*t
      for(let j=0;j<=6;j++) {
        const side=j/3-1
        positions.push(...hairPoint(a+side*(.006+.22*taper),theta,.002+.028*(1-side*side)*taper))
        if(i && j) {
          const n=i*7+j
          indices.push(n,n-7,n-8,n,n-8,n-1)
        }
      }
    }
    const shape=k.geometry(new T.BufferGeometry())
    shape.setAttribute('position',new T.Float32BufferAttribute(positions,3))
    shape.setIndex(indices); shape.computeVertexNormals()
    k.mesh(head,shape,colour)
  }
  const tuft=k.geometry(new T.LatheGeometry([[.080,0],[.098,.032],[.078,.071],[.046,.101],[.016,.126],[0,.133]]
    .map(([r,y])=>new T.Vector2(r,y)),24))
  const tip=tuft.attributes.position
  for(let i=0;i<tip.count;i++) {
    const h=tip.getY(i)/.133
    tip.setX(i,tip.getX(i)-.167*h*h)
  }
  tuft.computeVertexNormals()
  k.mesh(head,tuft,hair,-.093,.767,.01)
  k.bake(head)
  return head
}

function makeBag(k, body) {
  const bag = group(body, 0, 1.20, .202)
  for (const side of [-1, 1]) {
    k.stroke(bag, leather, [[side*.258,.28,.022],[side*.292,.254,-.18],
      [side*.305,.03,-.32],[side*.285,-.28,-.255],[side*.244,-.32,.04]], .046)
  }
  k.stroke(bag, '#805336', [[-.094,.29,0],[-.089,.406,.002],[0,.431,.006],[.090,.405,.002],[.094,.29,0]], .027)
  k.box(bag, '#b37a3f', 0, 0, .005, .638,.68,.24,.13)
  k.box(bag, '#dba153', 0, .005,.092, .624,.67,.255,.13)
  k.box(bag, '#eab971', 0,.166,.177, .634,.29,.171,.093).rotation.x = -.06
  k.box(bag, '#c38949', 0,-.151,.209, .473,.213,.099,.055)
  k.stroke(bag, '#edc383', [[-.198,-.122,.257],[-.103,-.126,.263],[.07,-.126,.263],[.202,-.122,.257]], .009)
  for (const x of [-.178, .178]) {
    k.box(bag, leather, x,.064,.264,.047,.154,.022,.015)
    k.box(bag, '#e9cb8b', x,.055,.277,.060,.046,.015,.01)
    k.box(bag, '#9e6b43', x,.055,.286,.031,.018,.008,.003)
  }
  k.box(bag, '#f2d8a4', 0,.19,.266,.097,.066,.012,.012)
  k.stroke(bag, '#ac814c', [[-.025,.18,.277],[-.005,.202,.278],[.012,.185,.278],[.025,.195,.278]], .0045)
  k.oval(bag, '#a76e43', .305,-.134,.065,.070,.13,.101)
  k.turned(bag, '#92aca0', [[.048,0],[.051,.08],[.041,.104],[.031,.11]], .329,-.075,.062)
  k.turned(bag, '#e5d2ae', [[.036,0],[.038,.030],[.032,.038]], .329,.033,.062)
  k.bake(bag)
  return bag
}

function makeLeg(k, hips, side) {
  const leg = group(hips, side*.146, .725, 0)
  k.box(leg, '#4e6566', 0,-.10,0, .27,.34,.35,.083)
  k.box(leg, '#5d7573', 0,-.242,0, .273,.065,.349,.027)
  k.oval(leg, skin, 0,-.332,0, .086,.149,.093)
  k.turned(leg, '#f4eada', [[.079,0],[.08,.14],[.089,.15],[.087,.18]], 0,-.55,0)
  k.turned(leg, '#a7b5a5', [[.085,0],[.086,.02]], 0,-.408,0)
  k.box(leg, '#ded1b8', 0,-.659,-.034, .208,.080,.319,.038)
  k.box(leg, '#985d42', 0,-.599,-.045, .209,.125,.314,.055)
  k.box(leg, '#b47956', 0,-.583,.091, .110,.077,.036,.019)
  k.bake(leg)
  return leg
}

function makeArm(k, body, side) {
  const arm = group(body, side*.282, 1.38, -.014)
  k.oval(arm, knit, side*.057,-.15,0, .119,.243,.13).rotation.z = side*.20
  k.oval(arm, rib, side*.093,-.304,0, .095,.066,.109)
  k.oval(arm, skin, side*.102,-.367, -.009, .083,.098,.074)
  k.bake(arm)
  return arm
}

function makeUmbrella(k, body) {
  const umbrella = group(body, -.39, 1.08, -.12)
  umbrella.rotation.z = -.18
  const shaft = group(umbrella)
  k.stroke(shaft, '#79624e', [[.089,-.055,0],[.071,-.09,0],[.022,-.09,0],[0,-.049,0],[0,1.71,0]], .017)
  k.bake(shaft)
  const canopy = group(umbrella, 0, 1.44, 0)
  const ribs = 10, radial = 7, steps = 8, radius = .79
  const positions = [], colors = [], indices = []
  const green = new T.Color('#6caaa3'), light = new T.Color('#9ec8b5')
  function point(t, angle, scallop = 0) {
    const r = radius*t*(1-.034*scallop*t*t)
    return [r*Math.cos(angle), .277*(1-t*t)-.073*t**4*scallop, r*Math.sin(angle)]
  }
  for (let panel = 0; panel < ribs; panel++) {
    const offset = positions.length/3
    const col = panel % 2 ? light : green
    for (let ring = 0; ring <= radial; ring++) {
      for (let s = 0; s <= steps; s++) {
        positions.push(...point(ring/radial, (panel+s/steps)*2*Math.PI/ribs, Math.sin(Math.PI*s/steps)))
        colors.push(col.r,col.g,col.b)
        if (ring && s) {
          const i = offset+ring*(steps+1)+s
          indices.push(i,i-1,i-steps-2, i,i-steps-2,i-steps-1)
        }
      }
    }
    const angle = panel*2*Math.PI/ribs
    k.stroke(canopy, '#b4d0ba', [0,.25,.5,.75,1].map(t => {
      const [x,y,z] = point(t,angle)
      return [x,y+.005,z]
    }), .008)
  }
  k.oval(canopy, '#926849', 0,.298,0, .035,.052,.035)
  k.bake(canopy)
  const fabric = k.geometry(new T.BufferGeometry())
  fabric.setAttribute('position', new T.Float32BufferAttribute(positions,3))
  fabric.setAttribute('color', new T.Float32BufferAttribute(colors,3))
  fabric.setIndex(indices)
  fabric.computeVertexNormals()
  k.mesh(canopy, fabric, k.material(new T.MeshStandardMaterial({vertexColors:true, side:T.DoubleSide,roughness:.9})))
  return { umbrella, canopy }
}

export function createStudent(k, scene) {
  const actor = group(scene, .07,.042,.17)
  actor.scale.setScalar(1.11)
  const body = group(actor)
  const torso = group(body)
  k.oval(torso, knit, 0,1.135,-.027,.32,.396,.226)
  k.box(torso, knit, 0,.845,0,.552,.25,.386,.102)
  k.box(torso, rib, 0,.756,.01,.557,.09,.389,.035)
  k.oval(torso, skin, 0,1.498,-.045,.13,.128,.132)
  k.oval(torso, teal, 0,1.461,-.032,.205,.071,.175)
  k.oval(torso, '#698479', .113,1.363,-.185,.077,.169,.042).rotation.z = -.28
  k.bake(torso)
  const legs = [-1,1].map(side => makeLeg(k,body,side))
  const arms = [-1,1].map(side => makeArm(k,body,side))
  const head = makeHead(k,body), bag = makeBag(k,body)
  const {umbrella,canopy} = makeUmbrella(k,body)
  const bearing = -.48

  return function pose(time, weather, reactionTime, still) {
    const step = still ? .78 : Math.sin(time*3.65)
    const phase = Math.min(reactionTime / 1.30, 1)
    const arc = weather === 'sunny' && !still ? Math.sin(Math.PI*phase)**2 : 0
    const turn = phase*phase*(3-2*phase)
    const look = weather === 'cloudy' ? (still ? .7 : .35+.65*Math.sin(Math.PI*Math.min(reactionTime/2.0,1))**2) : 0
    actor.rotation.y = bearing + (weather === 'sunny' && !still ? Math.PI*2*turn : 0)
    actor.position.y = .042 + arc*.49
    body.position.y = .024*Math.abs(step)
    body.rotation.z = -.030*step + arc*.065
    legs[0].rotation.x = step*.34 - arc*.44
    legs[1].rotation.x = -step*.34 + arc*.22
    arms[0].rotation.x = weather === 'rain' ? .45 : -step*.22
    arms[1].rotation.x = step*.22
    arms[0].rotation.z = -.1 - arc*.68
    arms[1].rotation.z = .1 + arc*.68
    head.rotation.set(.35*look, .32*look, .032*step + .075*look)
    bag.rotation.x = -.032*Math.abs(step)
    umbrella.visible = weather === 'rain'
    if (umbrella.visible) {
      const opened = still ? 1 : Math.min(1, .2+reactionTime*2.7)
      canopy.scale.set(opened, .75+.25*opened, opened)
      umbrella.rotation.z = -.18 + .017*step
    }
  }
}
