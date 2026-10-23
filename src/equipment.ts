import type { DeviceKind, Rect } from './network.ts';
export interface EquipmentSprite {width:number;height:number;crop:Rect}
// 只读取 alpha 边界作为显示元数据；原始生图像素保持不变。
export const EQUIPMENT:Record<DeviceKind,EquipmentSprite>={
  "solar": {
    "width": 1254,
    "height": 1254,
    "crop": {
      "x": 25,
      "y": 274,
      "width": 1201,
      "height": 828
    }
  },
  "wind": {
    "width": 1254,
    "height": 1254,
    "crop": {
      "x": 286,
      "y": 28,
      "width": 810,
      "height": 1211
    }
  },
  "battery": {
    "width": 1254,
    "height": 1254,
    "crop": {
      "x": 18,
      "y": 321,
      "width": 1236,
      "height": 683
    }
  },
  "bus": {
    "width": 1254,
    "height": 1254,
    "crop": {
      "x": 0,
      "y": 59,
      "width": 1254,
      "height": 1188
    }
  },
  "critical": {
    "width": 1254,
    "height": 1254,
    "crop": {
      "x": 52,
      "y": 216,
      "width": 1202,
      "height": 949
    }
  },
  "residential": {
    "width": 1254,
    "height": 1254,
    "crop": {
      "x": 15,
      "y": 169,
      "width": 1239,
      "height": 956
    }
  }
};

