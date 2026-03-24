# manju

AI 漫剧一体化创作平台（TypeScript 全栈）。

## 项目简介

这个项目支持从一句话想法到可落地的漫剧内容生产：

1. 一句话生成分镜（1~5 个）
2. 每个分镜可编辑
3. 每个分镜生成图片
4. 每张图片生成视频
5. 多个分镜视频可调整顺序并一键合并成长视频
6. 图片/视频全部落本地 SQLite 资源库

## 版本迭代记录

### v0.3.0（当前）

- 完成「一句话拆分镜」能力（DeepSeek 按固定分镜结构输出，最多 5 个）
- 完成「分镜 -> 图片 -> 视频」生产链路
- 完成多视频顺序调整 + 一键合并，支持长视频效果
- 资源库支持本地持久化与删除

### v0.2.0

- 完成分镜级图片生成
- 完成分镜级视频生成（可选时长）
- 增加资源库展示

### v0.1.0

- 完成基础前后端骨架
- 完成剧本生成接口与前端调用

## 分镜结构（DeepSeek 输出规范）

每个分镜固定包含：

- 【角色】
- 【场景】
- 【动作/事件】
- 【镜头语言】
- 【情绪/氛围】
- 【风格/画质】

## 模型说明

### 文本模型（分镜生成）

- Provider: QNAIGC
- Base URL: `https://api.qnaigc.com/v1`
- Model: `deepseek/deepseek-v3.2-251201`

### 图片模型（分镜出图）

- Provider: QNAIGC
- Base URL: `https://api.qnaigc.com/v1`
- Model: `kling-v2`

### 视频模型（图转视频）

- Provider: QNAIGC
- Base URL: `https://api.qnaigc.com/v1`
- Model: `kling-v2-6`

当前产品策略（已落地）：

- `prompt`：来自当前分镜文本（可编辑后再生成）
- `sound`：固定开启
- `seconds`：前端可选（5s / 10s）
- `input_reference`：固定一张参考图（单镜单图）
- `size`：默认分辨率

> 注意：不同视频模型对“图转视频”的支持范围不同。若切换到其他模型，可能不支持输入参考图或参数口径不同，请先核对对应模型文档。

## 视频合并说明

- 支持前端排序后“一键合并”
- 合并方式：FFmpeg concat（顺序拼接）
- 为兼容较老 Mac 环境，使用的是轻量安装包：`@ffmpeg-installer/ffmpeg`
- 不依赖系统全量 Homebrew ffmpeg

## 技术栈

- Frontend: TypeScript + Vite
- Backend: TypeScript + Fastify
- DB: SQLite（本地）
- Video merge: `@ffmpeg-installer/ffmpeg`

## 本地启动

### 1) 后端

```bash
cd backend
npm install
cp .env.example .env
# 在 .env 填写 QNAIGC_API_KEY
npm run dev
```

### 2) 前端

```bash
cd frontend
npm install
npm run dev
```

## 安全说明

- 请不要提交 `.env`
- API Key 仅保存在后端环境变量
- 仓库中仅保留 `.env.example` 模板
