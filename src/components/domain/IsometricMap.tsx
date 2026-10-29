// @ts-nocheck
'use client'

import { Component, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type ReactNode, type RefObject } from 'react'
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber'
import { Environment, Html, Lightformer, OrbitControls } from '@react-three/drei'
import { EffectComposer, N8AO, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import * as THREE from 'three'
import { AlertTriangle, CloudFog, Fan, PanelTopOpen, Users, Wind, X } from 'lucide-react'
import type { ActionType, EnvironmentEvent, MetricKey, PriorityAssessment, ZoneStatus } from '../../data/types'
import { getZone, ZONES } from '../../data/zones'
import {
  ACTION_TYPE_LABELS,
  EVENT_STATUS_LABELS,
  METRIC_META,
  ZONE_STATUS_COLORS,
  ZONE_STATUS_LABELS,
} from '../../domain/constants'
import { formatDateTime, formatNumber } from '../../domain/format'
import { metricStatus, effectiveZoneStatus } from '../../domain/priority'
import { CLIENT_ID } from '../../services/mqttClient'
import { useAppStore } from '../../state/AppStore'
import { useLiveData } from '../../state/LiveDataContext'
import { useToast } from '../../state/ToastContext'
import { getActiveEventForZone } from '../../state/selectors'
import { Classroom3D } from './Classroom3D'
import { Canteen3D } from './Canteen3D'
import { Dorm3D } from './Dorm3D'
import type { InteriorAction, InteriorSceneProps } from './interiorShared'

/** 单文件程序化校园：几何与贴图全部程序生成，无外部模型或 HDR。区域颜色由 MQTT 业务状态驱动。单位：米。 */
export type CoreZoneId = 'zone-w' | 'zone-s' | 'zone-n'
export interface IsometricMapProps {
  /** 实时 Priority 评估（MQTT 驱动）：无未关闭事件时按瞬时 zoneStatus 着色。 */
  priorities?: ReadonlyArray<Pick<PriorityAssessment, 'zoneId' | 'score' | 'zoneStatus'>>
  /** 未关闭事件：事件生命周期覆盖瞬时状态——OPEN=红，处置中=橙；同时显示楼顶标记与标签脉冲点。 */
  activeEvents?: ReadonlyArray<Pick<EnvironmentEvent, 'zoneId' | 'title' | 'status'>>
  selectedZoneId?: string
  onSelect?: (zoneId: string) => void
  /** 兼容旧接口。此视觉版本只显示名称与状态色，不显示指标文本。 */
  zoneMetrics?: Partial<Record<CoreZoneId, { label: string; value: string | number; unit?: string }>>
  className?: string
  /** 关闭环境遮蔽以降低集成显卡负担；不改变校园几何。 */
  quality?: 'high' | 'standard'
}
type V3 = [number, number, number]
type Kind = 'box' | 'sphere' | 'cylinder' | 'cone' | 'leaf' | 'wheel'
type Surface = 'wall' | 'roof' | 'glass' | 'ground' | 'foliage' | 'metal' | 'water' | 'cloth'
interface Part { p: V3; s: V3; r: V3; c: string }
interface Batch { kind: Kind; material: Surface; parts: Part[] }
interface Flat { points: [number, number][]; holes?: [number, number][][]; color: string; y: number; water?: boolean }
interface Model { batches: Batch[]; flats: Flat[]; count: Record<string, number> }
const PI = Math.PI
const TARGET: V3 = [0, 0, 0]
// 南偏东约 20° 的 45° 俯视：比正南正北多一点立体感，又比 45° 等距视角端正；正交相机下距离不影响大小（由 CameraRig 按容器自动取景）。
const CAMERA = { position: [60, 170, 160] as V3, near: 0.5, far: 650, zoom: 4.6 }
const GL = { antialias: true, alpha: false, powerPreference: 'high-performance' as const }
const DPR: [number, number] = [1, 1.75]
const LABELS: { id: CoreZoneId; name: string; position: V3 }[] = [
  { id: 'zone-w', name: '第二食堂', position: [-52, 14, -14] },
  { id: 'zone-s', name: '教学区 A', position: [14, 21, 30] },
  { id: 'zone-n', name: '东区宿舍', position: [59, 24, -32] },
]

function seeded(seed: number) {
  let v = seed >>> 0
  return () => { v = (Math.imul(v, 1664525) + 1013904223) >>> 0; return v / 4294967296 }
}

/** 每类几何/材质合为 InstancedMesh，草木和窗格不会产生数千次 draw call。 */
class Builder {
  batches = new Map<string, Batch>()
  flats: Flat[] = []
  count: Record<string, number> = {}
  rng = seeded(20261022)
  add(kind: Kind, material: Surface, p: V3, s: V3, c: string, r: V3 = [0, 0, 0]) {
    const key = `${kind}:${material}`
    if (!this.batches.has(key)) this.batches.set(key, { kind, material, parts: [] })
    this.batches.get(key)!.parts.push({p, s, c, r})
  }
  box(p: V3, s: V3, c: string, m: Surface = 'wall', r: V3 = [0, 0, 0]) { this.add('box', m, p, s, c, r) }
  rod(a: V3, b: V3, width: number, color: string, material: Surface = 'metal') {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), direction = end.clone().sub(start)
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize())
    const e = new THREE.Euler().setFromQuaternion(q)
    this.add('cylinder', material, start.add(end).multiplyScalar(.5).toArray() as V3,
      [width, direction.length(), width], color, [e.x, e.y, e.z])
  }
  stroke(points: [number, number][], width: number, color: string, y = .12, material: Surface = 'ground') {
    for(let i = 1; i < points.length; i++) {
      const [x,z]=points[i-1], [xx,zz]=points[i], dx=xx-x,dz=zz-z
      this.box([(x+xx)/2,y,(z+zz)/2],[Math.hypot(dx,dz)+width*.2,.035,width],color,material,[0,-Math.atan2(dz,dx),0])
    }
  }
  flat(points: [number, number][], color: string, y = .05, holes?: [number, number][][], water = false) {
    this.flats.push({points,color,y,holes,water})
  }
  mark(key: string) { this.count[key] = (this.count[key] ?? 0) + 1 }
  finish(): Model { return {batches:[...this.batches.values()], flats:this.flats, count:this.count} }
}

function ellipse(x:number,z:number,rx:number,rz:number,segments=96):[number,number][] {
  return Array.from({length:segments+1},(_,i)=>[x+Math.cos(i/segments*PI*2)*rx,z+Math.sin(i/segments*PI*2)*rz])
}
function stadium(x:number,z:number,straight:number,radius:number):[number,number][] {
  const pts:[number,number][]=[]
  for(let i=0;i<=64;i++){const t=-PI/2+i/64*PI;pts.push([x+straight/2+Math.cos(t)*radius,z+Math.sin(t)*radius])}
  for(let i=0;i<=64;i++){const t=PI/2+i/64*PI;pts.push([x-straight/2+Math.cos(t)*radius,z+Math.sin(t)*radius])}
  pts.push(pts[0]);return pts
}

function building(b:Builder,x:number,z:number,w:number,d:number,floors:number,style:'academic'|'dorm'|'canteen'|'annex') {
  const floor=3.25,h=floor*floors,y0=.42
  b.box([x,.2,z],[w+2.6,.4,d+2.6],'#c5c6ba','ground')
  b.box([x,y0+h/2,z],[w,h,d],'#e5e6df')
  // 薄楼板、深窗洞、玻璃和真实窗框分开建模。
  for(let f=0;f<floors;f++) {
    const y=y0+f*floor+1.72
    for(const side of [-1,1]) {
      const count=Math.floor((w-1.6)/2.6),spacing=(w-1.8)/count
      for(let c=0;c<count;c++) {
        const xx=x+(c-(count-1)/2)*spacing
        b.box([xx,y,z+side*(d/2+.025)],[spacing-.64,2.18,.06],'#3e4e52')
        b.box([xx,y+.03,z+side*(d/2+.08)],[spacing-.83,1.96,.065],(c+f)%4===0?'#a2b3b5':'#7b959e','glass')
        b.box([xx,y,z+side*(d/2+.15)],[.065,2.33,.1],'#d0d7d5')
        b.box([xx,y-.2,z+side*(d/2+.15)],[spacing-.64,.065,.1],'#d8dcd6')
        if(style==='dorm') {
          b.box([xx,y-1.08,z+side*(d/2+.45)],[spacing-.12,.14,.85],'#d2d7d2')
          b.box([xx,y-.5,z+side*(d/2+.81)],[spacing-.16,.075,.06],'#b2bdbb','metal')
          for(let k=-1;k<=1;k++)b.box([xx+k*spacing*.26,y-.75,z+side*(d/2+.81)],[.045,.55,.045],'#c3ccca','metal')
          if(c%4===1)b.box([xx+.75,y-.2,z+side*(d/2+.36)],[.44,.65,.5],'#bdc4c1')
        }
      }
      for(let c=0;c<Math.floor(d/2.6);c++) {
        const zz=z+(c-(Math.floor(d/2.6)-1)/2)*2.6
        b.box([x+side*(w/2+.04),y,zz],[.1,2.22,1.65],'#627e87','glass')
        b.box([x+side*(w/2+.13),y,zz],[.08,2.35,.075],'#ebede5')
      }
    }
    b.box([x,y0+f*floor+.16,z],[w+.35,.44,d+.35],'#f0eee4')
  }
  // 窄立柱使白色建筑有清晰竖向节奏。
  const columns=Math.floor(w/5.2)
  for(let c=0;c<=columns;c++)for(const side of [-1,1])
    b.box([x-w/2+.2+c*(w-.4)/columns,y0+h/2,z+side*(d/2+.28)],[.62,h,.56],'#edece4')
  b.box([x,y0+h,z],[w+.4,.35,d+.4],'#eeeee7')
  b.box([x,y0+h+.2,z],[w-.5,.12,d-.5],'#b7bcb8','roof')
  for(let xx=x-w/2+1;xx<x+w/2-.5;xx+=1.8)b.box([xx,y0+h+.269,z],[.018,.012,d-.7],'#a9b2ae','roof')
  for(let zz=z-d/2+1;zz<z+d/2-.5;zz+=1.8)b.box([x,y0+h+.27,zz],[w-.7,.012,.018],'#a9b2ae','roof')
  for(const side of [-1,1]) {
    b.box([x,y0+h+.55,z+side*d/2],[w+.35,.75,.25],'#e9e9e1')
    b.box([x+side*w/2,y0+h+.55,z],[.25,.75,d],'#e9e9e1')
  }
  for(let i=0;i<Math.max(2,Math.floor(w/13));i++){
    const xx=x-w*.31+i*12
    b.box([xx,y0+h+1,z-d*.15],[3.4,1.55,2.6],'#e1e3dd')
    b.box([xx,y0+h+1.82,z-d*.15],[3.6,.12,2.8],'#f4f2e9')
    for(let k=0;k<3;k++)b.box([xx-.8+k*.8,y0+h+1,z-d*.15+1.32],[.44,.72,.06],'#727f80')
  }
  if(style==='canteen') {
    // 两层通高幕墙、柱廊及玻璃入口。
    b.box([x,5.8,z+d/2+.36],[w-7,4.4,.15],'#64858e','glass')
    for(let i=0;i<=26;i++) b.box([x-(w-7)/2+i*(w-7)/26,5.8,z+d/2+.48],[.085,4.5,.15],'#c9d0cb','metal')
    for(const yy of [4.1,5.7,7.3]) b.box([x,yy,z+d/2+.48],[w-7,.09,.16],'#bbc8c7')
    b.box([x,3.35,z+d/2+2.8],[w-5,.23,5.6],'#dce0db')
    for(let xx=x-w/2+3;xx<x+w/2-1;xx+=5)b.box([xx,1.8,z+d/2+4.9],[.28,3.2,.28],'#eae9dd')
  } else if(style!=='annex') {
    b.box([x,2,z+d/2+.25],[4.2,3.2,.2],'#567782','glass')
    b.box([x,3.6,z+d/2+1.7],[6.2,.22,3.5],'#dddeda')
    for(let i=0;i<3;i++)b.box([x,.12+i*.12,z+d/2+2.5-i*.5],[6.4,.2,2.5-i*.5],'#c6cac5','ground')
  }
}

function tree(b:Builder,x:number,z:number,size=1,flower=false) {
  const rand=b.rng,h=(4.6+rand()*2)*size
  b.rod([x,0,z],[x,h*.8,z],.24*size,'#7f7760','wall')
  for(let i=0;i<5;i++) {
    const a=i*2.399,dx=Math.cos(a)*1.1*size,dz=Math.sin(a)*1.1*size
    b.rod([x,h*.48,z],[x+dx,h*.9,z+dz],.09*size,'#82785c','wall')
  }
  const colors=flower?['#dba9b5','#e7bfcd','#ca92a2']:['#6b8830','#8ba63c','#9fb347','#72933c','#a3b64a']
  for(let i=0;i<72;i++) {
    const a=rand()*PI*2,rad=Math.sqrt(rand())*2.3*size,yy=rand()*2.9*size
    const s=(.62+rand()*.65)*size
    b.add('leaf','foliage',[x+Math.cos(a)*rad,h*.62+yy,z+Math.sin(a)*rad],[s,s*.7,s*.85],colors[Math.floor(rand()*colors.length)],[rand()*PI,rand()*PI,rand()*PI])
  }
}
function shrub(b:Builder,x:number,z:number,s=1,flower=false) {
  for(let i=0;i<9;i++) {
    const a=b.rng()*PI*2,r=b.rng()*.8*s
    b.add('leaf','foliage',[x+Math.cos(a)*r,.45*s+b.rng()*.35,z+Math.sin(a)*r],[.45*s,.45*s,.45*s],flower?(i%2?'#d7a1ad':'#bf8c98'):(i%2?'#5f762c':'#7d8c3d'))
  }
}
function person(b:Builder,x:number,z:number,a=0,scale=1) {
  b.mark('students')
  const colors=['#f2ede4','#d7dfe2','#416d83','#303d4b','#a75d48','#ba9a69','#52545e']
  const shirt=colors[Math.floor(b.rng()*colors.length)],skin=['#bd9475','#d4b094','#a77e5f'][Math.floor(b.rng()*3)]
  const p=(dx:number,y:number,dz:number):V3=>[x+(dx*Math.cos(a)-dz*Math.sin(a))*scale,y*scale,z+(dx*Math.sin(a)+dz*Math.cos(a))*scale]
  b.add('sphere','cloth',p(0,1.58,0),[.14*scale,.18*scale,.14*scale],skin)
  b.add('sphere','cloth',p(0,1.7,-.015),[.145*scale,.085*scale,.145*scale],'#303029')
  b.add('box','cloth',p(0,1.08,0),[.4*scale,.65*scale,.24*scale],shirt,[0,a,0])
  for(const side of [-1,1]) {
    b.rod(p(side*.12,.79,0),p(side*.16,.12,side*.17),.11*scale,'#34434c','cloth')
    b.rod(p(side*.23,1.31,0),p(side*.29,.8,-side*.13),.08*scale,skin,'cloth')
    b.box(p(side*.16,.08,side*.17+.06),[.14*scale,.12*scale,.27*scale],'#e1ded5','cloth',[0,a,0])
  }
  if(b.rng()>.4)b.box(p(0,1.13,-.19),[.3*scale,.42*scale,.15*scale],'#6f6856','cloth',[0,a,0])
}
function bench(b:Builder,x:number,z:number,a=0) {
  for(let i=0;i<4;i++)b.box([x,.65,z+(i-1.5)*.14],[2,.09,.12],'#9c7b4f','wall',[0,a,0])
  for(const dx of [-.7,.7]) b.box([x+dx,.32,z],[.09,.6,.5],'#424f4b','metal')
  b.box([x,1.04,z-.3],[2,.55,.085],'#a8875c','wall')
}
function lamp(b:Builder,x:number,z:number) {
  b.rod([x,0,z],[x,5,z],.085,'#45514d')
  b.rod([x,4.95,z],[x+.7,5.1,z],.06,'#45514d')
  b.box([x+.65,5.08,z],[.7,.12,.36],'#f0efdf')
}
function bicycle(b:Builder,x:number,z:number,a=0) {
  const point=(dx:number,y:number,dz=0):V3=>[x+dx*Math.cos(a)-dz*Math.sin(a),y,z+dx*Math.sin(a)+dz*Math.cos(a)]
  for(const dx of [-.55,.55]) b.add('wheel','metal',point(dx,.38),[.34,.34,.34],'#3d4543',[0,-a,0])
  const nodes:V3[]=[point(-.55,.38),point(-.15,.83),point(.05,.38),point(.4,.9),point(.55,.38)]
  for(const [i,j] of [[0,1],[1,2],[0,2],[1,3],[2,3],[3,4]])b.rod(nodes[i],nodes[j],.035,'#6b8283')
  b.box(point(-.15,.89),[.25,.06,.16],'#363e3c','metal')
  b.rod(point(.4,.9),point(.4,1.05),.035,'#414e4b')
  b.rod(point(.4,1.05,-.23),point(.4,1.05,.23),.035,'#414e4b')
}
function bikeShelter(b:Builder,x:number,z:number,length=14) {
  for(let dx=-length/2;dx<=length/2;dx+=length/4)b.rod([x+dx,0,z-1],[x+dx,2.65,z-1],.085,'#747f7e')
  b.box([x,2.72,z],[length,.1,3.4],'#7395a3','glass',[.09,0,0])
  for(let dx=-length/2;dx<=length/2;dx+=1.8)b.box([x+dx,2.78,z],[.06,.07,3.45],'#d9dfd7','metal',[.09,0,0])
  for(let dx=-length/2+.6;dx<length/2;dx+=.75)bicycle(b,x+dx,z,PI/2)
}
function station(b:Builder,x:number,z:number) {
  b.mark('stations')
  b.box([x,.13,z],[1,.26,1],'#bbc0b6','ground')
  b.box([x,1.6,z],[.38,2.9,.38],'#f0f0e6')
  b.box([x,2.55,z+.17],[.7,.9,.47],'#e9ebe3')
  b.box([x,2.65,z+.42],[.35,.24,.03],'#356c71','glass')
  b.box([x,3.35,z],[1.05,.07,.75],'#365f76','glass',[.25,0,0])
  b.rod([x+.3,2.7,z],[x+.3,3.8,z],.04,'#b9c5bf')
  b.add('sphere','wall',[x+.3,3.84,z],[.12,.12,.12],'#eeece0')
}

function makeCampus():Model {
  const b=new Builder()
  b.box([0,-.5,0],[216,1,198],'#71814e','ground')
  b.box([0,.008,0],[187,.04,170],'#7e9756','ground')
  // 完整路网：环路 + 横向主路 + 教学区两侧道路。
  for(const x of [-94,94])b.box([x,.035,0],[7,.08,178],'#737d7e','ground')
  for(const z of [-86,86])b.box([0,.035,z],[195,.08,7],'#737d7e','ground')
  b.box([0,.045,4],[187,.08,6.5],'#768081','ground')
  for(const x of [-37,54])b.box([x,.045,45],[6,.08,78],'#788181','ground')
  for(const x of [-89,89])b.box([x,.09,0],[2.7,.13,168],'#cdd0c3','ground')
  for(const z of [-81,81])b.box([0,.09,z],[176,.13,2.8],'#d1d2c7','ground')
  for(const z of [-.8,8.8])b.box([0,.09,z],[177,.13,2.5],'#d5d4c8','ground')
  for(const x of [-32.6,49.6])b.box([x,.1,44],[2.5,.13,70],'#d1d2c7','ground')
  for(let x=-85;x<90;x+=6)for(const z of [4,86,-86])b.box([x,.1,z],[2,.018,.12],'#d7dacf','ground')
  for(const x of [-37,54,-94,94])for(let z=13;z<80;z+=6)b.box([x,.1,z],[.12,.018,2],'#d7dacf','ground')
  for(const [x,z,rot] of [[-37,4,0],[54,4,0],[-37,80,0],[54,80,0],[-23,4,PI/2]])
    for(let k=-3;k<=3;k++)b.box([x+(rot?k*.65:0),.11,z+(rot?0:k*.65)],[rot?.32:5,.025,rot?5:.32],'#e5e5d9','ground')
  // 左后体育区：标准形态跑道、草皮足球场和两个蓝色篮球场。
  b.flat(stadium(-51,-59,43,20),'#d1cbb7',.08)
  b.flat(stadium(-51,-59,43,18.7),'#b86554',.09)
  b.flat(stadium(-51,-59,43,12.5),'#7d9846',.105)
  for(let r=13.4;r<18.8;r+=.88)b.stroke(stadium(-51,-59,43,r),.085,'#e9d9c1',.13)
  for(let i=0;i<10;i++)b.box([-77+i*5.5,.13,-59],[5.5,.02,22],i%2?'#7f984d':'#8a9f53','ground')
  b.stroke([[-78,-70],[-24,-70],[-24,-48],[-78,-48],[-78,-70]],.11,'#e9ecce',.16)
  b.stroke([[-51,-70],[-51,-48]],.1,'#e9ecce',.16)
  b.stroke(ellipse(-51,-59,5,5),.1,'#e9ecce',.16)
  for(const x of [-78,-24]) {
    const sign=x<-50?1:-1
    b.stroke([[x,-66],[x+sign*8,-66],[x+sign*8,-52],[x,-52]],.1,'#e9ecce',.16)
    for(const dz of [-3,3])b.rod([x,.2,-59+dz],[x,2.6,-59+dz],.065,'#f1f1e7')
    b.rod([x,2.6,-62],[x,2.6,-56],.065,'#f1f1e7')
    for(let dz=-3;dz<=3;dz+=.4)b.rod([x,2.6,-59+dz],[x-sign*1.3,.18,-59+dz],.018,'#c3cec0')
  }
  for(const x of [1,18]) {
    b.mark('courts');b.box([x,.15,-58],[15.7,.12,30.5],'#bfc8bf','ground')
    b.box([x,.23,-58],[14.5,.07,28.5],'#4f88a5','ground')
    b.stroke([[x-6.5,-71],[x+6.5,-71],[x+6.5,-45],[x-6.5,-45],[x-6.5,-71]],.09,'#d6e7df',.29)
    b.stroke([[x-6.5,-58],[x+6.5,-58]],.09,'#d6e7df',.29)
    b.stroke(ellipse(x,-58,1.9,1.9),.09,'#d6e7df',.29)
    for(const z of [-69.5,-46.5]) {
      const sign=z<-58?1:-1
      b.stroke([[x-2.5,z],[x-2.5,z+sign*4.5],[x+2.5,z+sign*4.5],[x+2.5,z]],.09,'#d6e7df',.29)
      b.stroke(ellipse(x,z+sign*3,4.6,4.6).filter(p=>sign*(p[1]-z)>0),.09,'#d6e7df',.29)
      b.rod([x,.3,z-sign*.8],[x,3.9,z-sign*.8],.13,'#e2e8db')
      b.box([x,3.9,z],[1.8,1.05,.09],'#c5d9d7','glass')
      b.add('wheel','metal',[x,3.35,z+sign*.45],[.4,.4,.4],'#c68250',[PI/2,0,0])
    }
  }
  for(const [x,z] of [[-86,-77],[-15,-77],[-86,-39],[27,-40]]){
    b.rod([x,0,z],[x,11,z],.16,'#a7b4af');b.box([x,11,z],[1.7,.6,.5],'#e0e4d9')
  }
  // 食堂主楼及较矮附楼，庭院遮阳伞与露天座席。
  building(b,-53,-20,47,21,3,'canteen')
  building(b,-82,-20,10,22,2,'annex')
  b.box([-62,.14,-4],[53,.12,9],'#d5cdbb','ground')
  for(const x of [-82,-77,-72])for(const z of [-5,0]) {
    b.add('cylinder','wall',[x,.8,z],[1.2,.12,1.2],'#a1875d')
    b.rod([x,.2,z],[x,2.9,z],.045,'#8c8c76')
    b.add('cone','wall',[x,2.85,z],[1.6,.45,1.6],'#eee9d6')
    for(const dx of [-1,1])b.box([x+dx,.5,z],[.55,.12,.55],'#a38255')
  }
  // 三栋独立宿舍，轻质玻璃连廊连接，但只设一个区域标签。
  for(const z of [-65,-39,-13]) {building(b,60,z,40,12,6,'dorm');b.mark('dorms')}
  for(const z of [-52,-26]) {
    b.box([73,7.4,z],[3.6,.3,14],'#d8dcd5')
    b.box([73,8.8,z],[3.3,2.5,14],'#91aab0','glass')
    b.box([73,10.15,z],[3.8,.18,14.4],'#e0e4dd')
    for(let zz=z-6;zz<=z+6;zz+=2)for(const xx of [71.3,74.7])b.box([xx,8.8,zz],[.08,2.6,.09],'#d5ddd4','metal')
  }
  for(const z of [-55,-29,-3])b.box([60,.12,z],[44,.18,5],'#cfd1c4','ground')
  // 连接教学、食堂和宿舍的中央花园；交叉步道保留通行空间。
  b.box([5,.1,-19],[52,.12,2.4],'#cdc9b8','ground')
  b.box([7,.1,-15],[2.4,.12,38],'#cdc9b8','ground')
  for(const x of [-13,24])for(const z of [-29,-8]) {
    b.box([x,.22,z],[10,.35,7],'#b8bcaa','ground')
    b.box([x,.42,z],[9.6,.08,6.6],'#728a48','ground')
    tree(b,x,z,.95);shrub(b,x-3,z+2,.9,true);shrub(b,x+3,z+2,.9,true)
    bench(b,x,z+4.3);lamp(b,x+5,z+3.8)
  }
  b.add('cylinder','ground',[7,.17,-19],[4.1,.25,4.1],'#d5cbb5')
  b.add('cylinder','wall',[7,.65,-19],[1.1,.9,1.1],'#bfc5be')
  for(let i=0;i<22;i++) {
    const a=i/21*PI*1.7
    b.rod([7+Math.cos(a)*1.1,1+i*.14,-19+Math.sin(a)*1.1],
      [7+Math.cos(a+.3)*1.1,1+(i+1)*.14,-19+Math.sin(a+.3)*1.1],.12,'#7d969a')
  }
  for(let i=0;i<14;i++)person(b,3+b.rng()*8,-31+b.rng()*32,b.rng()*PI*2)
  // U 型连体教学区，三翼围合内部开放庭院。
  building(b,9,20,67,12,5,'academic');b.mark('academicWings')
  for(const x of [-18.5,36.5]) {
    building(b,x,45,12,38,5,'academic');b.mark('academicWings')
    b.box([x,7,64.1],[7,11,.15],'#779aa4','glass')
    for(const xx of [-2,0,2])b.box([x+xx,7,64.24],[.12,11,.18],'#e2e6de')
  }
  b.box([9,.16,46],[41,.16,40],'#d6d0be','ground')
  b.box([9,.17,72],[72,.18,12],'#d9d2bf','ground')
  for(let x=-25;x<=44;x+=2.2)b.box([x,.27,72],[.025,.013,12],'#bbbcae','ground')
  for(let z=67;z<78;z+=2)b.box([9,.27,z],[72,.013,.025],'#bbbcae','ground')
  for(const x of [-4,22])for(const z of [36,48,59]) {
    b.box([x,.32,z],[7,.35,6],'#c1c5b6','ground')
    b.box([x,.52,z],[6.7,.05,5.7],'#8d9e5c','ground')
    tree(b,x,z,.6);shrub(b,x+2,z+1,.7);bench(b,x,z+3.9)
  }
  for(const x of [-6,25])for(const z of [12,79])tree(b,x,z,.75)
  // 两侧公园：自然岸线、水池、环形石子路及岛状灌木。
  for(const [x,z,rx,rz] of [[-67,48,12,20],[76,42,8,15]]) {
    const pts:[number,number][]=Array.from({length:97},(_,i)=>{const a=i/96*PI*2,r=1+.08*Math.sin(a*3)+.05*Math.cos(a*5);return[x+Math.cos(a)*rx*r,z+Math.sin(a)*rz*r]})
    b.stroke(pts.map(([xx,zz])=>[x+(xx-x)*1.24,z+(zz-z)*1.17]),2.1,'#d4cbb5',.15)
    b.flat(pts,'#b8bd9d',.13)
    b.flat(pts.map(([xx,zz])=>[x+(xx-x)*.94,z+(zz-z)*.96]),'#5e9294',.15,undefined,true)
    for(let i=0;i<30;i++) {
      const a=i/30*PI*2,xx=x+Math.cos(a)*rx,zz=z+Math.sin(a)*rz
      if(i%3===0)b.add('sphere','wall',[xx,.5,zz],[.6,.5,.85],'#a5ab91')
      else shrub(b,xx,zz,.65,i%5===0)
    }
    for(let i=0;i<5;i++){const xx=x+(b.rng()-.5)*rx,zz=z+(b.rng()-.5)*rz;b.stroke(ellipse(xx,zz,1.4,.3,22),.025,'#87aba0',.18,'water')}
    for(let i=0;i<26;i++) {
      const a=b.rng()*PI*2,xx=x+Math.cos(a)*rx*1.07,zz=z+Math.sin(a)*rz*1.07
      for(let j=0;j<4;j++)b.rod([xx,.15,zz],[xx+(b.rng()-.5)*.7,.5+b.rng()*1.2,zz+(b.rng()-.5)*.7],.025,'#8a9a58','wall')
    }
    bench(b,x-rx-3,z+3);bench(b,x+2,z+rz+3)
  }
  // 边界树林，内部保留通透的建筑视线。
  for(let x=-103;x<=103;x+=5)for(const z of [-94,94])tree(b,x+(b.rng()-.5)*2,z+(b.rng()-.5)*3,1+b.rng()*.5)
  for(let z=-86;z<=86;z+=5)for(const x of [-104,104])tree(b,x+(b.rng()-.5)*2,z,1+b.rng()*.4)
  for(let x=-100;x<=100;x+=7)for(const z of [-98,98])tree(b,x,z,.9+b.rng()*.5)
  for(let z=-83;z<=83;z+=7)for(const x of [-108,108])tree(b,x,z,.9+b.rng()*.5)
  for(const z of [-79,-36])for(let x=-84;x<28;x+=7)tree(b,x,z,.85+b.rng()*.2)
  for(const z of [-53,-27])for(let x=38;x<87;x+=7){tree(b,x,z,.8);shrub(b,x+2,z,1,true)}
  for(const x of [-85,-44,61,85])for(let z=15;z<=76;z+=9){tree(b,x,z,.85+b.rng()*.2);if(z%3===0)shrub(b,x+2,z,1,true)}
  for(const [x,z] of [[-81,27],[-49,68],[-53,31],[80,63],[65,69],[-47,-3],[30,-35],[87,-63]])tree(b,x,z,.8,true)
  for(let x=-85;x<=85;x+=10) {lamp(b,x,9.5);lamp(b,x,80);if(x>-40&&x<48)continue;shrub(b,x,12,.7)}
  for(const x of [-31,49])for(let z=20;z<76;z+=14){lamp(b,x,z);bench(b,x+(x<0?2:-2),z+3)}
  bikeShelter(b,-52,11,18);bikeShelter(b,20,11,15)
  bikeShelter(b,58,-3,21);bikeShelter(b,55,-56,14)
  bikeShelter(b,-28,60,10);bikeShelter(b,32,78,15)
  for(const [x,z] of [[-45,19],[-48,76],[62,72],[84,67],[-85,13],[30,-34],[84,-76],[-12,-38]])station(b,x,z)
  // 沿人行道、教学庭院、运动场布置学生；所有随机布局固定种子。
  for(let i=0;i<90;i++) {
    let x:number,z:number
    if(i<30){x=-86+b.rng()*172;z=i%2?9.3:-.8}
    else if(i<50){x=-23+b.rng()*65;z=68+b.rng()*9}
    else if(i<66){x=8+(b.rng()-.5)*14;z=31+b.rng()*30}
    else if(i<78){x=38+b.rng()*47;z=i%2?-55:-29}
    else{x=-73+b.rng()*39;z=-7+b.rng()*4}
    person(b,x,z,b.rng()*PI*2)
  }
  for(let i=0;i<16;i++)person(b,-77+b.rng()*50,-69+b.rng()*20,b.rng()*PI*2)
  for(let i=0;i<12;i++)person(b,(i<6?1:18)+(b.rng()-.5)*10,-68+b.rng()*20,b.rng()*PI*2)
  for(const [x,z] of [[-37,35],[54,61],[-21,4],[32,4],[-94,30],[10,86]]){bicycle(b,x,z,PI/2);person(b,x,z,PI/2)}
  return b.finish()
}

const MODEL = makeCampus()

function Geometry({kind}:{kind:Kind}) {
  if(kind==='sphere')return <sphereGeometry args={[1,10,7]} />
  if(kind==='leaf')return <planeGeometry args={[2,2]} />
  if(kind==='cylinder')return <cylinderGeometry args={[1,1,1,7]} />
  if(kind==='cone')return <coneGeometry args={[1,1,12]} />
  if(kind==='wheel')return <torusGeometry args={[1,.075,4,14]} />
  return <boxGeometry args={[1,1,1]} />
}
/** 可离线复现的树叶簇与细颗粒表面纹理，不读取图片文件。 */
function useProceduralTexture(type:'leaves'|'surface') {
  const texture=useMemo(()=>{
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=512
    const ctx=canvas.getContext('2d')!,rng=seeded(type==='leaves'?72:19)
    if(type==='leaves') {
      for(let i=0;i<160;i++) {
        const a=rng()*PI*2,r=Math.sqrt(rng())*205,x=256+Math.cos(a)*r,y=256+Math.sin(a)*r
        const size=8+rng()*20,shade=Math.floor(218+rng()*37)
        ctx.save();ctx.translate(x,y);ctx.rotate(rng()*PI)
        ctx.fillStyle=`rgb(${shade},${shade},${shade})`;ctx.beginPath();ctx.ellipse(0,0,size*.48,size,0,0,PI*2);ctx.fill()
        ctx.strokeStyle=`rgba(90,90,90,.3)`;ctx.lineWidth=.8;ctx.beginPath();ctx.moveTo(0,-size);ctx.lineTo(0,size);ctx.stroke();ctx.restore()
      }
    }else{
      const data=ctx.createImageData(512,512)
      for(let y=0;y<512;y++)for(let x=0;x<512;x++) {
        const v=228+rng()*27,i=(y*512+x)*4
        data.data[i]=v;data.data[i+1]=v;data.data[i+2]=v;data.data[i+3]=255
      }
      ctx.putImageData(data,0,0)
    }
    const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=8
    if(type==='surface'){tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.repeat.set(9,9)}
    return tex
  },[type])
  useEffect(()=>()=>texture.dispose(),[texture])
  return texture
}
function SurfaceMaterial({surface}:{surface:Surface}) {
  const map=useProceduralTexture(surface==='foliage'?'leaves':'surface')
  if(surface==='foliage')return <meshStandardMaterial color="white" map={map} alphaTest={.45} side={THREE.DoubleSide} roughness={.95} emissive="#617637" emissiveIntensity={.16}/>
  return <meshStandardMaterial color="white" map={map} roughness={surface==='metal'?.5:.91} metalness={surface==='metal'?.3:0}/>
}
const Instanced = memo(function Instanced({batch}:{batch:Batch}) {
  const ref=useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(()=>{
    const mesh=ref.current!,matrix=new THREE.Matrix4(),q=new THREE.Quaternion(),e=new THREE.Euler(),color=new THREE.Color()
    for(let i=0;i<batch.parts.length;i++) {
      const {p,s,r,c}=batch.parts[i];q.setFromEuler(e.set(...r))
      matrix.compose(new THREE.Vector3(...p),q,new THREE.Vector3(...s));mesh.setMatrixAt(i,matrix);mesh.setColorAt(i,color.set(c))
    }
    mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;mesh.computeBoundingSphere()
  },[batch])
  return <instancedMesh ref={ref} args={[undefined,undefined,batch.parts.length]} castShadow={batch.material!=='ground'&&batch.material!=='water'} receiveShadow>
    <Geometry kind={batch.kind}/>
    {batch.material==='glass'?<meshPhysicalMaterial color="white" roughness={.21} metalness={.28} envMapIntensity={1.1} clearcoat={.7}/>
      :batch.material==='water'?<meshPhysicalMaterial color="white" roughness={.23} metalness={.15} clearcoat={1}/>
      :<SurfaceMaterial surface={batch.material}/>} 
  </instancedMesh>
})
const FlatSurface=memo(function FlatSurface({flat}:{flat:Flat}) {
  const shape=useMemo(()=>{
    const shape=new THREE.Shape(flat.points.map(([x,z])=>new THREE.Vector2(x,-z)))
    for(const hole of flat.holes??[])shape.holes.push(new THREE.Path(hole.map(([x,z])=>new THREE.Vector2(x,-z))))
    return shape
  },[flat])
  return <mesh rotation={[-PI/2,0,0]} position={[0,flat.y,0]} receiveShadow>
    <shapeGeometry args={[shape]}/>
    {flat.water?<meshPhysicalMaterial color="#46777b" roughness={.24} metalness={.3} clearcoat={1} envMapIntensity={1.2}/>:<meshStandardMaterial color={flat.color} roughness={1}/>}
  </mesh>
})
const CampusWorld=memo(function CampusWorld() {
  return <group name="campus-world" userData={MODEL.count}>
    {MODEL.batches.map(batch=><Instanced key={`${batch.kind}:${batch.material}`} batch={batch}/>)}
    {MODEL.flats.map((flat,i)=><FlatSurface key={i} flat={flat}/>)}
  </group>
})

function CameraRig({locked}:{locked:boolean}) {
  const camera=useThree(s=>s.camera),size=useThree(s=>s.size),invalidate=useThree(s=>s.invalidate)
  useLayoutEffect(()=>{
    if(!(camera instanceof THREE.OrthographicCamera))return
    camera.lookAt(...TARGET);camera.updateMatrixWorld(true)
    const box=new THREE.Box3()
    for(const x of [-109,109])for(const y of [0,27])for(const z of [-99,99])
      box.expandByPoint(new THREE.Vector3(x,y,z).applyMatrix4(camera.matrixWorldInverse))
    const extent=box.getSize(new THREE.Vector3())
    // 宽屏稍近的建筑展示视图；手机留出标签和完整场地的边距。
    const framing=size.width<700||size.height<500?.94:1.2
    camera.zoom=Math.max(.3,Math.min(size.width/extent.x,size.height/extent.y)*framing)
    camera.updateProjectionMatrix();invalidate()
  },[camera,size.width,size.height,invalidate])
  // 详情面板打开时锁定旋转（enableRotate=false），操作面板不会误转场景；缩放与平移保留。
  return <OrbitControls makeDefault target={TARGET} enableDamping dampingFactor={.12} enablePan
    enableRotate={!locked}
    minPolarAngle={.15} maxPolarAngle={1.15} minZoom={.6} maxZoom={20} maxDistance={600}/>
}
function Labels({portal,selected,onSelect,statusByZone,eventZoneIds}:{portal:RefObject<HTMLDivElement>;selected?:string;onSelect?:(id:string)=>void;statusByZone:Partial<Record<string,ZoneStatus>>;eventZoneIds:ReadonlySet<string>}) {
  return <>{LABELS.map(label=>{
    const status=statusByZone[label.id]??'NORMAL'
    const color=ZONE_STATUS_COLORS[status]??ZONE_STATUS_COLORS.NORMAL
    return <Html key={label.id} portal={portal} position={label.position} occlude={false}
      transform={false} zIndexRange={[30,20]} style={{pointerEvents:'none',transform:'translate(-50%,-100%)'}}>
      <div className="campus-name"><button type="button" data-zone-label={label.id} aria-pressed={selected===label.id}
        style={{borderColor:color}}
        onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();onSelect?.(label.id)}}>
        <b className="campus-status-dot" style={{background:color}}/>{label.name}
        {eventZoneIds.has(label.id)&&<b className="campus-event-dot" title="该区域有未关闭事件"/>}
      </button><span/><i/></div>
    </Html>
  })}</>
}
function HitRegions({onSelect}:{onSelect?:(id:string)=>void}) {
  const select=(id:string)=>(event:ThreeEvent<MouseEvent>)=>{event.stopPropagation();if(event.delta<5)onSelect?.(id)}
  return <group name="campus-hit-regions">
    {([{id:'zone-w',p:[-56,6,-20],s:[63,12,23]},{id:'zone-n',p:[60,11,-39],s:[42,22,66]},
      {id:'zone-s',p:[9,9,20],s:[68,18,13]},{id:'zone-s',p:[-18.5,9,45],s:[13,18,39]},
      {id:'zone-s',p:[36.5,9,45],s:[13,18,39]}] as {id:string;p:V3;s:V3}[]).map((item,i)=><mesh key={i} position={item.p} onClick={select(item.id)}>
      <boxGeometry args={item.s}/><meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false}/>
    </mesh>)}
  </group>
}

/** 面板处置动作：与 DispositionButton 使用同一组 ActionType 与 MQTT 链路；scene 为点击后 3D 教室播放的动画场景。 */
const PANEL_ACTIONS:{type:ActionType;label:string;hint:string;icon:typeof Fan;scene:'fan'|'window'}[]=[
  {type:'VENTILATION',label:'开启排风',hint:'启动区域机械通风 / 排风设备',icon:Fan,scene:'fan'},
  {type:'WINDOW_OPEN',label:'开窗通风',hint:'打开两侧窗户，加强自然通风换气',icon:PanelTopOpen,scene:'window'},
]
const MQTT_STATUS_LABELS={connecting:'连接中',online:'在线',reconnecting:'重连中',offline:'离线'} as const
/** 区域 → 内部实景 3D 场景：教学区 A=教室，第二食堂=食堂，东区宿舍=宿舍 */
const ZONE_SCENES:Record<CoreZoneId,ComponentType<InteriorSceneProps>>={
  'zone-s':Classroom3D,
  'zone-w':Canteen3D,
  'zone-n':Dorm3D,
}
/** 内部实景：程序化 3D 场景按区域渲染，场景标签按区域状态与处置动作切换 */
type SceneKey='normal'|'alert'|'fan'|'window'
const SCENE_LABELS:Record<SceneKey,string>={
  normal:'环境正常 · 秩序良好',
  alert:'指标异常 · 闷热拥挤',
  fan:'排风系统运行中',
  window:'开窗通风 · 自然换气',
}

/**
 * 点击建筑弹出的 2D 区域详情控制面板：
 * 纯 HTML 渲染在 Canvas 上层（CSS 毛玻璃 HUD），不参与校园 3D 渲染循环；
 * 上半部分为「内部实景模拟」3D 场景（按 zoneId 渲染教室/食堂/宿舍，独立小 Canvas）：
 * 正常/异常随 MQTT 数据自动切换灯光与人物，点击处置按钮立即播放排风/开窗动画，
 * 区域完全恢复后自动回到正常画面。
 * 处置动作复用 recordAction + publishDisposition + publishControl 链路，
 * 「处理中」状态由事件 HANDLING 数据驱动而非本地假状态。
 */
function ZoneDetailPanel({zoneId,onClose}:{zoneId:CoreZoneId;onClose:()=>void}) {
  const {readings,priorities,mqttStatus,publishDisposition,publishControl}=useLiveData()
  const {state,recordAction}=useAppStore()
  const {toast}=useToast()
  // 冷却：防止 1.2s 内重复点击刷出多条 Action 记录
  const [cooldown,setCooldown]=useState(false)
  // 无未关闭事件时的兜底反馈：指令已下发，但暂无事件可转入「处置中」
  const [dispatched,setDispatched]=useState<{label:string;at:string}|null>(null)
  // 处置动作触发的 3D 场景动画覆盖，绑定触发时的事件上下文；
  // 区域恢复或事件切换后 override 自动失效（render 期派生，无需 effect 清理）
  const [sceneOverride,setSceneOverride]=useState<{scene:'fan'|'window';eventId:string|null}|null>(null)

  const zone=getZone(zoneId)
  const Scene3D=ZONE_SCENES[zoneId]
  const reading=readings[zoneId]
  const zoneStatus=priorities.find(item=>item.zoneId===zoneId)?.zoneStatus??'NORMAL'
  const activeEvent=getActiveEventForZone(state,zoneId)
  const handling=Boolean(activeEvent&&activeEvent.status!=='OPEN')
  const isAbnormal=zoneStatus!=='NORMAL'||activeEvent!=null
  const latestAction=activeEvent
    ?state.actions.filter(item=>item.eventId===activeEvent.eventId).at(-1)
    :undefined
  const badgeText=activeEvent?EVENT_STATUS_LABELS[activeEvent.status]:ZONE_STATUS_LABELS[zoneStatus]
  const badgeColor=activeEvent
    ?activeEvent.status==='OPEN'?ZONE_STATUS_COLORS.CRITICAL:ZONE_STATUS_COLORS.ALERT
    :ZONE_STATUS_COLORS[zoneStatus]
  // 场景优先级：处置画面（仅当触发时的事件上下文仍有效）> 异常 > 正常
  const sceneKey:SceneKey=sceneOverride&&isAbnormal&&sceneOverride.eventId===(activeEvent?.eventId??null)
    ?sceneOverride.scene
    :(isAbnormal?'alert':'normal')
  // 3D 场景动作映射：fan→排风扇/空调冷气流；window→玻璃窗向外旋开
  const sceneAction:InteriorAction=sceneKey==='fan'?'FAN':sceneKey==='window'?'WINDOW':null

  // Esc 关闭面板
  useEffect(()=>{
    function onKey(event:KeyboardEvent){if(event.key==='Escape')onClose()}
    window.addEventListener('keydown',onKey)
    return ()=>window.removeEventListener('keydown',onKey)
  },[onClose])

  function dispatchAction(type:ActionType) {
    if(cooldown)return
    const option=PANEL_ACTIONS.find(item=>item.type===type)
    const label=option?.label??'处置动作'
    const actionAt=new Date().toISOString()
    // 有未关闭事件：走完整处置链路——登记 Action、事件 OPEN→HANDLING、MQTT 多端同步
    if(activeEvent){
      const result=recordAction(activeEvent.eventId,{
        type,
        title:`快速处置：${label}`,
        note:'通过 3D 地图区域控制面板下发。',
        operator:'现场值班组',
        at:actionAt,
      })
      if(!result.ok){toast(result.message,'warning');return}
      publishDisposition(zoneId,{
        zoneId,eventId:activeEvent.eventId,type,actionAt,
        status:'HANDLING',operator:'现场值班组',clientId:CLIENT_ID,
      })
    }
    // 联动演练：通知模拟器进入恢复模式；无事件时区域达到告警线会自动补建事件
    publishControl({action:'START_RECOVERY',zoneId,eventId:activeEvent?.eventId??null,at:actionAt,clientId:CLIENT_ID})
    // 3D 场景立即播放处置动画（绑定当前事件上下文，事件结束后自动回到数据驱动画面）
    if(option)setSceneOverride({scene:option.scene,eventId:activeEvent?.eventId??null})
    setDispatched({label,at:actionAt})
    setCooldown(true)
    window.setTimeout(()=>setCooldown(false),1200)
    toast(
      mqttStatus==='online'
        ?`【${label}】指令已下发至${zone.shortName}，并经 MQTT 同步到处置链路。`
        :`【${label}】已在本端记录；MQTT 离线，暂无法多端同步。`,
      'success',
    )
  }

  const metrics:{key:MetricKey;value:number|null;icon:typeof Wind}[]=[
    {key:'pm25',value:reading?.pm25??null,icon:Wind},
    {key:'co2',value:reading?.co2??null,icon:CloudFog},
    {key:'crowdDensity',value:reading?.crowdLevel??null,icon:Users},
  ]

  return <div className="zone-panel-layer">
    <section className="zone-panel" role="dialog" aria-modal="false" aria-label={`${zone.shortName}详情控制面板`}>
      <header className="zone-panel__head">
        <span className="zone-panel__eyebrow">ZONE CONSOLE · {zoneId.toUpperCase()}</span>
        <button type="button" className="zone-panel__close" onClick={onClose} aria-label="关闭面板"><X size={15}/></button>
      </header>
      <div className="zone-panel__title-row">
        <div>
          <h3>{zone.name}</h3>
          <p>{zone.building} · {zone.category}</p>
        </div>
        <span className="zone-panel__badge" style={{color:badgeColor,borderColor:badgeColor}}>
          <i style={{background:badgeColor}}/>{badgeText}
        </span>
      </div>
      {/* 内部实景模拟：按区域渲染对应 3D 场景（教室/食堂/宿舍），灯光与人物随状态切换，处置动作播放排风/开窗动画 */}
      <div className="zone-panel__scene">
        <Scene3D status={isAbnormal?'ALERT':'NORMAL'} actionType={sceneAction}
          style={{minHeight:0,borderRadius:0}}/>
        <span className="zone-panel__scene-live"><i/>LIVE · 内部实景</span>
        <span className="zone-panel__scene-label">{SCENE_LABELS[sceneKey]}</span>
        <div className="zone-panel__scene-metrics">
          {metrics.map(({key,value,icon:Icon})=>{
            const meta=METRIC_META[key]
            const mColor=value===null?'#8fa8a2':ZONE_STATUS_COLORS[metricStatus(key,value)]
            return <span className="zone-panel__chip" key={key}>
              <Icon size={11}/>{meta.shortLabel}
              <b style={{color:mColor}}>{value===null?'--':formatNumber(value,meta.digits)}</b>
              <small>{meta.unit}</small>
            </span>
          })}
        </div>
      </div>
      {isAbnormal?(
        <div className="zone-panel__ops">
          <div className="zone-panel__ops-head">
            <AlertTriangle size={13}/>
            {handling?'处置进行中 · 可追加指令':'检测到异常指标 · 建议立即处置'}
          </div>
          <div className="zone-panel__actions">
            {PANEL_ACTIONS.map(option=><button key={option.type} type="button" disabled={cooldown}
              onClick={()=>dispatchAction(option.type)} title={option.hint}>
              <option.icon size={15}/>
              <span><strong>{option.label}</strong><small>{option.hint}</small></span>
            </button>)}
          </div>
          {handling&&activeEvent?(
            <div className="zone-panel__handling">
              <i/>处理中 · {latestAction?`${ACTION_TYPE_LABELS[latestAction.type]}已于 ${formatDateTime(latestAction.actionAt)} 登记`:'事件已转入处置'}
              ，等待数据回落自动评估恢复。
            </div>
          ):dispatched?(
            <div className="zone-panel__handling zone-panel__handling--info">
              <i/>【{dispatched.label}】指令已于 {formatDateTime(dispatched.at)} 下发；当前区域无未关闭事件，达到告警线后将自动建单。
            </div>
          ):null}
        </div>
      ):(
        <div className="zone-panel__ok">各项指标处于正常范围，无需处置操作。</div>
      )}
      <footer className="zone-panel__foot">
        <span className={`zone-panel__mqtt zone-panel__mqtt--${mqttStatus}`}>MQTT {MQTT_STATUS_LABELS[mqttStatus]}</span>
        <span>{reading?`快照 ${formatDateTime(reading.time)}`:'等待 MQTT 实时数据'}</span>
      </footer>
    </section>
  </div>
}
/** 状态体积与 HitRegions 使用同一组区域包围盒：几何不变，数据更新只改颜色与透明度。 */
const STATUS_TINT_OPACITY:Record<ZoneStatus,number>={NORMAL:.05,WATCH:.16,ALERT:.26,CRITICAL:.33}
const ZONE_VOLUMES:{id:CoreZoneId;boxes:{p:V3;s:V3}[];ring:V3;ringRadius:number}[]=[
  {id:'zone-w',boxes:[{p:[-56,6,-20],s:[63,12,23]}],ring:[-53,.4,-16],ringRadius:33},
  {id:'zone-s',boxes:[{p:[9,9,20],s:[68,18,13]},{p:[-18.5,9,45],s:[13,18,39]},{p:[36.5,9,45],s:[13,18,39]}],ring:[9,.4,42],ringRadius:40},
  {id:'zone-n',boxes:[{p:[60,11,-39],s:[42,22,66]}],ring:[60,.4,-39],ringRadius:38},
]
const ZoneStatusLayer=memo(function ZoneStatusLayer({statusByZone,eventZoneIds,selectedZoneId}:{statusByZone:Partial<Record<string,ZoneStatus>>;eventZoneIds:ReadonlySet<string>;selectedZoneId?:string}) {
  return <group name="zone-status-layer">
    {ZONE_VOLUMES.map(zone=>{
      const status=statusByZone[zone.id]??'NORMAL'
      const color=ZONE_STATUS_COLORS[status]??ZONE_STATUS_COLORS.NORMAL
      const roofY=(b:{p:V3;s:V3})=>b.p[1]+b.s[1]/2+.15
      // raycast={()=>null}：着色层只负责显示，不遮挡 HitRegions 的点击。
      return <group key={zone.id}>
        {zone.boxes.map((b,i)=><mesh key={i} position={b.p} raycast={()=>null}>
          <boxGeometry args={b.s}/><meshBasicMaterial color={color} transparent opacity={STATUS_TINT_OPACITY[status]} depthWrite={false}/>
        </mesh>)}
        {/* 屋顶色条：与旧版“屋顶色条=区域状态”语义一致，MQTT 数据变化时只改颜色 */}
        {zone.boxes.map((b,i)=><mesh key={`roof-${i}`} position={[b.p[0],roofY(b),b.p[2]]} raycast={()=>null}>
          <boxGeometry args={[b.s[0]*.94,.3,b.s[2]*.94]}/><meshBasicMaterial color={color} transparent opacity={.82} depthWrite={false}/>
        </mesh>)}
        {selectedZoneId===zone.id&&<mesh rotation={[-PI/2,0,0]} position={zone.ring} raycast={()=>null}>
          <ringGeometry args={[zone.ringRadius,zone.ringRadius+1.6,72]}/>
          <meshBasicMaterial color={color} transparent opacity={.95} side={THREE.DoubleSide} depthWrite={false}/>
        </mesh>}
        {/* 事件标记球与建筑同色：OPEN 红、处置中橙，事件关闭后消失 */}
        {eventZoneIds.has(zone.id)&&<mesh position={[zone.boxes[0].p[0],roofY(zone.boxes[0])+2.6,zone.boxes[0].p[2]]} raycast={()=>null}>
          <sphereGeometry args={[1.15,18,12]}/><meshBasicMaterial color={color} toneMapped={false}/>
        </mesh>}
      </group>
    })}
  </group>
})
const Lighting=memo(function Lighting(){return <>
  <color attach="background" args={['#e2e7db']}/>
  <hemisphereLight args={['#dfeaff','#98966c',.8]}/>
  <ambientLight intensity={.12}/>
  <directionalLight position={[-80,120,90]} color="#fff5e6" intensity={2.8} castShadow
    shadow-mapSize={[4096,4096]} shadow-camera-left={-145} shadow-camera-right={145}
    shadow-camera-top={145} shadow-camera-bottom={-145} shadow-camera-near={1} shadow-camera-far={350}
    shadow-bias={-.00012} shadow-normalBias={.055} shadow-radius={2}/>
  <Environment resolution={128} frames={1} environmentIntensity={.45}>
    <color attach="background" args={['#b1c8d6']}/>
    <Lightformer position={[-30,50,0]} scale={[55,55,1]} intensity={2} color="#fff3dc" rotation={[-PI/3,0,0]}/>
    <Lightformer position={[50,20,10]} scale={[60,35,1]} intensity={1} color="#b5cddc" rotation={[0,-PI/2,0]}/>
  </Environment>
</>})
class MapBoundary extends Component<{children:ReactNode},{failed:boolean}> {
  state={failed:false};static getDerivedStateFromError(){return{failed:true}}
  render(){return this.state.failed?<div className="campus-fallback">无法显示 3D 场景，请使用支持 WebGL 2 的浏览器并开启硬件加速。</div>:this.props.children}
}
const CSS=`
.campus-reproduction{position:relative;isolation:isolate;width:100%;height:100%;min-height:400px;aspect-ratio:848/560;overflow:hidden;background:#e2e7db;font-family:"Microsoft YaHei","PingFang SC",sans-serif}
.campus-reproduction canvas{display:block;touch-action:none}.campus-label-overlay{position:absolute;inset:0;z-index:5;pointer-events:none}
.campus-name{display:flex;flex-direction:column;align-items:center;white-space:nowrap;pointer-events:none}
.campus-name button{pointer-events:auto;border:1px solid #67949c;border-radius:8px;background:linear-gradient(120deg,#fffffff2,#f3f8f4db);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);color:#233c50;box-shadow:0 3px 10px #243c3d19;padding:9px 23px;font:600 15px/1.25 "Microsoft YaHei",sans-serif;cursor:pointer;letter-spacing:.5px}
.campus-name button[aria-pressed=true]{border-color:#357b87;box-shadow:0 0 0 1px #ffffffb0,0 3px 12px #254d4322}
.campus-name button:focus-visible{outline:3px solid #368d9a;outline-offset:3px}.campus-name span{height:23px;width:1px;background:#7aa5a7}.campus-name i{width:5px;height:5px;border-radius:50%;background:#5d9ea3;border:1px solid #e2f3ed}
.campus-tools{position:absolute;bottom:15px;left:18px;z-index:40;display:flex;gap:9px;align-items:center;pointer-events:none;font-size:11px;color:#344e47;background:#ffffffc9;border:1px solid #ffffffbf;border-radius:6px;padding:7px 11px;backdrop-filter:blur(6px)}
.campus-fallback{display:grid;place-items:center;height:100%;min-height:0;padding:24px;text-align:center}
.campus-status-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:7px;vertical-align:1px;box-shadow:0 0 0 2px #ffffff80}
.campus-event-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-left:8px;vertical-align:1px;background:#d9534f;animation:campus-event-pulse 1.3s ease-in-out infinite}
@keyframes campus-event-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.3;transform:scale(1.6)}}
/* 区域详情控制面板：HTML 层白色毛玻璃弹窗，与 Web 端浅色视觉一致 */
.zone-panel-layer{position:absolute;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:18px;pointer-events:none}
.zone-panel{pointer-events:auto;position:relative;width:min(650px,80vw);max-width:94%;max-height:min(86vh,calc(100% - 16px));overflow-y:auto;overflow-x:hidden;border-radius:16px;border:1px solid rgba(255,255,255,.85);background:linear-gradient(160deg,rgba(255,255,255,.94),rgba(246,250,248,.9));backdrop-filter:blur(18px) saturate(1.4);-webkit-backdrop-filter:blur(18px) saturate(1.4);box-shadow:0 26px 70px rgba(22,48,43,.3),inset 0 0 0 1px rgba(226,235,232,.6);color:#16302b;padding:16px 18px 12px;animation:zone-panel-in .34s cubic-bezier(.18,.9,.26,1.18)}
.zone-panel::before{content:"";position:absolute;top:10px;left:10px;width:16px;height:16px;border-top:2px solid rgba(13,155,134,.5);border-left:2px solid rgba(13,155,134,.5);border-top-left-radius:6px;pointer-events:none}
.zone-panel::after{content:"";position:absolute;bottom:10px;right:10px;width:16px;height:16px;border-bottom:2px solid rgba(13,155,134,.5);border-right:2px solid rgba(13,155,134,.5);border-bottom-right-radius:6px;pointer-events:none}
@keyframes zone-panel-in{from{opacity:0;transform:translateY(16px) scale(.94)}to{opacity:1;transform:none}}
.zone-panel__head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.zone-panel__eyebrow{font-size:10.5px;letter-spacing:2.2px;color:#0d9b86;font-weight:600}
.zone-panel__close{display:grid;place-items:center;width:28px;height:28px;border-radius:8px;border:1px solid #e2ebe8;background:rgba(246,250,248,.9);color:#4f6762;cursor:pointer;transition:background .15s,border-color .15s,color .15s}
.zone-panel__close:hover{background:#eef4f2;border-color:#cfdeda;color:#16302b}
.zone-panel__title-row{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:10px}
.zone-panel__title-row h3{margin:0;font-size:21px;letter-spacing:.5px;color:#16302b}
.zone-panel__title-row p{margin:4px 0 0;font-size:11.5px;color:#7f958f}
.zone-panel__badge{flex-shrink:0;display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600;padding:5px 12px;border:1px solid;border-radius:999px;background:rgba(255,255,255,.8)}
.zone-panel__badge i{width:7px;height:7px;border-radius:50%;box-shadow:0 0 6px currentColor}
/* 内部实景 3D 教室：宽幅铺满面板上半部，叠层角标与实时指标胶囊浮于 Canvas 之上 */
.zone-panel__scene{position:relative;padding:0;border-radius:12px;overflow:hidden;aspect-ratio:2.2/1;border:1px solid #D1D5DB;background:#F0F4F8;margin-bottom:10px}
.zone-panel__scene-live{position:absolute;top:10px;left:10px;display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:600;letter-spacing:1.2px;color:#b3483a;background:rgba(255,255,255,.85);border:1px solid rgba(217,106,85,.35);border-radius:999px;padding:4px 10px;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
.zone-panel__scene-live i{width:6px;height:6px;border-radius:50%;background:#d96a55;box-shadow:0 0 6px rgba(217,106,85,.8);animation:campus-event-pulse 1.3s ease-in-out infinite}
.zone-panel__scene-label{position:absolute;top:10px;right:10px;font-size:10px;letter-spacing:.8px;color:#4f6762;background:rgba(255,255,255,.85);border:1px solid #e2ebe8;border-radius:999px;padding:4px 10px;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
.zone-panel__scene-metrics{position:absolute;left:10px;right:10px;bottom:10px;display:flex;gap:8px;flex-wrap:wrap}
.zone-panel__chip{display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:999px;background:rgba(255,255,255,.88);border:1px solid rgba(226,235,232,.9);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);font-size:11px;color:#4f6762}
.zone-panel__chip b{font-variant-numeric:tabular-nums;font-weight:600;font-size:12.5px}
.zone-panel__chip small{font-size:9.5px;color:#7f958f}
.zone-panel__ops-head{display:flex;align-items:center;gap:6px;font-size:12px;color:#c98a1e;margin-bottom:10px;letter-spacing:.5px}
.zone-panel__actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.zone-panel__actions button{display:flex;align-items:center;gap:10px;text-align:left;padding:11px 13px;border-radius:10px;border:1px solid #cfdeda;background:linear-gradient(150deg,#ffffff,#f2f7f5);color:#16302b;cursor:pointer;transition:transform .15s,box-shadow .15s,border-color .15s}
.zone-panel__actions button:hover:not(:disabled){transform:translateY(-1px);border-color:#0d9b86;box-shadow:0 6px 16px rgba(13,155,134,.18)}
.zone-panel__actions button:disabled{opacity:.55;cursor:default}
.zone-panel__actions svg{flex-shrink:0;color:#0d9b86}
.zone-panel__actions span{display:flex;flex-direction:column;gap:2px}
.zone-panel__actions strong{font-size:13px}
.zone-panel__actions small{font-size:10px;color:#7f958f;line-height:1.35}
.zone-panel__handling{display:flex;align-items:center;gap:7px;margin-top:12px;font-size:11.5px;line-height:1.5;color:#9a6b12;border:1px dashed #eedcae;border-radius:8px;padding:9px 12px;background:#fbf3df}
.zone-panel__handling--info{color:#2e8b6a;border-color:#c3e4d5;background:#e6f4ee}
.zone-panel__handling i{flex-shrink:0;width:7px;height:7px;border-radius:50%;background:#c98a1e;animation:campus-event-pulse 1.3s ease-in-out infinite}
.zone-panel__handling--info i{background:#2e8b6a}
.zone-panel__ok{font-size:12px;color:#2e8b6a;border:1px dashed #c3e4d5;border-radius:8px;padding:10px 12px;background:#e6f4ee}
.zone-panel__foot{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px;padding-top:8px;border-top:1px solid #e2ebe8;font-size:10.5px;color:#7f958f;letter-spacing:.4px}
.zone-panel__mqtt{display:inline-flex;align-items:center;gap:5px}
.zone-panel__mqtt::before{content:"";width:6px;height:6px;border-radius:50%;background:#a8bcb5}
.zone-panel__mqtt--online::before{background:#0d9b86;box-shadow:0 0 6px rgba(13,155,134,.6)}
.zone-panel__mqtt--connecting::before,.zone-panel__mqtt--reconnecting::before{background:#c98a1e}
@media(max-width:600px){.campus-name button{font-size:11px;padding:6px 10px;border-radius:6px}.campus-name span{height:15px}.campus-tools{font-size:9px;left:8px;bottom:8px}
.zone-panel-layer{padding:10px}.zone-panel{padding:12px 13px 10px}.zone-panel__actions{grid-template-columns:1fr}.zone-panel__chip{padding:3px 8px}}
`

/** 保留原业务参数；更新数据不改变几何、材质或相机，只改变区域着色。父组件请不要使用随数据变化的 key。 */
export const IsometricMap=memo(function IsometricMap({priorities=[],activeEvents=[],selectedZoneId,onSelect,className='',quality='high'}:IsometricMapProps) {
  const overlay=useRef<HTMLDivElement>(null!)
  // 点击建筑打开的详情控制面板；打开期间锁定场景旋转（CameraRig enableRotate=false）
  const [panelZoneId,setPanelZoneId]=useState<CoreZoneId|null>(null)
  const closePanel=useCallback(()=>setPanelZoneId(null),[])
  // 三态联动：未关闭事件的生命周期优先于 MQTT 瞬时数据档位——
  // OPEN=红（事件刚触发）；HANDLING/STILL_HANDLING/INSUFFICIENT_EVIDENCE=橙（处置中，告警未彻底解除，
  // 即使数据已回落也不变回青绿）；无未关闭事件=按瞬时 zoneStatus（正常=青绿）。
  // 规则实现收敛在 effectiveZoneStatus，与 2D 地图、顶部仪表盘共用一份。
  const statusByZone=useMemo(()=>{
    const map:Partial<Record<string,ZoneStatus>>={}
    for(const item of priorities){
      map[item.zoneId]=effectiveZoneStatus(
        item.zoneStatus,
        activeEvents.filter(event=>event.zoneId===item.zoneId),
      )
    }
    return map
  },[priorities,activeEvents])
  const eventZoneIds=useMemo(()=>new Set(activeEvents.map(event=>event.zoneId)),[activeEvents])
  // 建筑 / 标签点击：保持原有区域选中联动，同时弹出详情控制面板
  function handleSelect(zoneId:string){
    onSelect?.(zoneId)
    if(ZONES.some(zone=>zone.zoneId===zoneId))setPanelZoneId(zoneId as CoreZoneId)
  }
  return <div className={`campus-reproduction ${className}`} role="region" aria-label="智慧校园三维鸟瞰图">
    <style>{CSS}</style><div className="campus-label-overlay" ref={overlay}/>
    <MapBoundary><Canvas orthographic camera={CAMERA} gl={GL} dpr={DPR} shadows="soft" frameloop="demand"
      fallback={<div className="campus-fallback">浏览器不支持 WebGL，请开启硬件加速。</div>}
      onCreated={({gl})=>{gl.outputColorSpace=THREE.SRGBColorSpace;gl.toneMapping=THREE.NoToneMapping}}>
      <Lighting/><CameraRig locked={panelZoneId!==null}/><CampusWorld/><HitRegions onSelect={handleSelect}/>
      <ZoneStatusLayer statusByZone={statusByZone} eventZoneIds={eventZoneIds} selectedZoneId={selectedZoneId}/>
      <Labels portal={overlay} selected={selectedZoneId} onSelect={handleSelect} statusByZone={statusByZone} eventZoneIds={eventZoneIds}/>
      <EffectComposer multisampling={4} enableNormalPass={false}>
        <N8AO enabled={quality==='high'} aoRadius={2.1} intensity={1.25} distanceFalloff={1} quality="medium" color="#354332"/>
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC}/>
      </EffectComposer>
    </Canvas></MapBoundary>
    {panelZoneId&&<ZoneDetailPanel key={panelZoneId} zoneId={panelZoneId} onClose={closePanel}/>}
    <div className="campus-tools">{panelZoneId?'面板打开中 · 场景旋转已锁定 · Esc 关闭':'拖动旋转 · 滚轮缩放 · 点击建筑查看详情'}</div>
  </div>
})
export default IsometricMap
