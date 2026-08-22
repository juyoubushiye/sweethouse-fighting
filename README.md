# 纸房子：放学后的对决

赵颖 VS 钟雅静的纯静态网页格斗游戏。支持桌面键盘、手机触控、离线双击运行和 GitHub Pages。

## 运行游戏

直接双击 `index.html` 即可离线运行，也可以使用任意静态文件服务器打开项目目录。

线上版本：<https://juyoubushiye.github.io/sweethouse-fighting/>

## 操作

- `A / D`：移动
- `J`：三段连击／格挡反击
- `K`：消耗能量呼叫援助
- `L`：格挡

手机端使用页面底部的触控按钮。

## 项目结构

```text
index.html          页面结构与加载入口
css/game.css        界面、响应式布局和动画
js/game.js          战斗、AI、输入与素材加载
assets/             游戏运行素材及 WebP/PNG 回退
qa_test.js          Playwright 桌面与手机自动测试
.github/workflows/  GitHub 自动 QA
```

代码和素材全部使用相对路径，不依赖服务端接口。不要直接修改原始解包素材；需要使用的素材应复制到仓库 `assets/` 中。

## 素材加载

加载器按优先级分为两组：

1. 基础素材：背景、待机、移动、拳击、格挡和受伤。完成后即可开始游戏。
2. 扩展素材：脚踢、胜利、必杀和双方援助，在后台继续加载。

现代浏览器优先使用 WebP，无法使用或加载失败时回退至 PNG。手机使用较小的背景资源。

## 自动测试

首次运行测试前安装开发依赖：

```powershell
npm install
npx playwright install chromium
```

执行完整 QA：

```powershell
npm test
```

测试覆盖素材加载与格式回退、桌面和手机布局、角色朝向、AI 状态、有效攻击判定、三连击、格挡反击、双方援助和必杀切入。

推送或创建拉取请求后，GitHub Actions 会自动执行同一套 QA。GitHub Pages 仍然发布仓库中的纯静态文件，不需要 Node.js 运行环境。
