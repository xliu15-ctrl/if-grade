import * as T from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'

export function group(parent, x = 0, y = 0, z = 0) {
  const part = new T.Group()
  part.position.set(x, y, z)
  parent.add(part)
  return part
}

// Keep static details in one draw call per moving part, including their clay colours.
export class Clay {
  geometries = new Set()
  materials = new Set()
  textures = new Set()
  colours = new Map()
  sphere = this.geometry(new T.SphereGeometry(1, 24, 16))
  detailSphere = this.geometry(new T.SphereGeometry(1, 14, 10))
  vertexClay = this.material(new T.MeshStandardMaterial({ vertexColors: true, roughness: .85 }))

  geometry(value) { this.geometries.add(value); return value }
  material(value) { this.materials.add(value); return value }
  texture(value) { this.textures.add(value); return value }

  matte(colour) {
    if (typeof colour !== 'string') return colour
    if (!this.colours.has(colour)) {
      this.colours.set(colour, this.material(new T.MeshStandardMaterial({ color: colour, roughness: .85 })))
    }
    return this.colours.get(colour)
  }

  mesh(parent, geometry, colour, x = 0, y = 0, z = 0) {
    const part = new T.Mesh(geometry, this.matte(colour))
    part.position.set(x, y, z)
    part.castShadow = part.receiveShadow = true
    parent.add(part)
    return part
  }

  oval(parent, colour, x, y, z, rx, ry, rz) {
    const shape = Math.max(rx,ry,rz) < .18 ? this.detailSphere : this.sphere
    const part = this.mesh(parent, shape, colour, x, y, z)
    part.scale.set(rx, ry, rz)
    return part
  }

  box(parent, colour, x, y, z, w, h, d, radius = .04) {
    const geometry = this.geometry(new RoundedBoxGeometry(w, h, d, 2, radius))
    return this.mesh(parent, geometry, colour, x, y, z)
  }

  turned(parent, colour, profile, x = 0, y = 0, z = 0, sides = 32) {
    const geometry = new T.LatheGeometry(profile.map(([r, h]) => new T.Vector2(r, h)), sides)
    return this.mesh(parent, this.geometry(geometry), colour, x, y, z)
  }

  stroke(parent, colour, coords, width) {
    const points = coords.map(p => new T.Vector3(...p))
    const curve = new T.CatmullRomCurve3(points)
    const geometry = new T.TubeGeometry(curve, Math.max(6, points.length * 3), width, 7, false)
    return this.mesh(parent, this.geometry(geometry), colour)
  }

  bake(part) {
    part.updateWorldMatrix(true, true)
    const local = part.matrixWorld.clone().invert()
    const matrix = new T.Matrix4(), normalMatrix = new T.Matrix3(), v = new T.Vector3()
    const positions = [], normals = [], colours = [], indices = []
    part.traverse(mesh => {
      if (!mesh.isMesh) return
      const shape = mesh.geometry, position = shape.attributes.position, normal = shape.attributes.normal
      const offset = positions.length / 3, { r, g, b } = mesh.material.color
      matrix.multiplyMatrices(local, mesh.matrixWorld)
      normalMatrix.getNormalMatrix(matrix)
      for (let i = 0; i < position.count; i++) {
        v.fromBufferAttribute(position, i).applyMatrix4(matrix)
        positions.push(v.x, v.y, v.z)
        v.fromBufferAttribute(normal, i).applyNormalMatrix(normalMatrix)
        normals.push(v.x, v.y, v.z)
        colours.push(r, g, b)
      }
      const index = shape.index
      for (let i = 0; i < (index ? index.count : position.count); i++) {
        indices.push(offset + (index ? index.getX(i) : i))
      }
    })
    const shape = this.geometry(new T.BufferGeometry())
    shape.setAttribute('position', new T.Float32BufferAttribute(positions, 3))
    shape.setAttribute('normal', new T.Float32BufferAttribute(normals, 3))
    shape.setAttribute('color', new T.Float32BufferAttribute(colours, 3))
    shape.setIndex(indices)
    part.clear()
    return this.mesh(part, shape, this.vertexClay)
  }

  dispose() {
    for (const collection of [this.geometries, this.materials, this.textures]) {
      collection.forEach(resource => resource.dispose())
      collection.clear()
    }
  }
}

export function paintedTexture(kit, width, height, paint) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  paint(canvas.getContext('2d'), width, height)
  const texture = kit.texture(new T.CanvasTexture(canvas))
  texture.colorSpace = T.SRGBColorSpace
  return texture
}

export function softSpot(kit) {
  return paintedTexture(kit, 96, 96, (ctx, w) => {
    const fade = ctx.createRadialGradient(w/2, w/2, 0, w/2, w/2, w/2)
    fade.addColorStop(0, '#ffffff')
    fade.addColorStop(.28, 'rgba(255,255,255,.75)')
    fade.addColorStop(.63, 'rgba(255,255,255,.22)')
    fade.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = fade
    ctx.fillRect(0, 0, w, w)
  })
}

export function seeded(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
}
