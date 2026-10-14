---
version: alpha
name: "医保报销计算器 MVP"
description: "面向评测者的双模式医保报销测算产品，以一张可信、可追溯的结算单呈现计算结果与系统边界。"
colors:
  ink: "#14313A"
  teal: "#056B65"
  teal-soft: "#D5EFEC"
  canvas: "#EDF3F3"
  paper: "#FFFFFF"
  line: "#BFCFCD"
  alert: "#B9473A"
  muted: "#5E7478"
  focus: "#005FCC"
typography:
  display:
    fontFamily: "Songti SC, STSong, SimSun, serif"
  sans:
    fontFamily: "PingFang SC, Microsoft YaHei, Noto Sans CJK SC, system-ui, sans-serif"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace"
rounded:
  sm: "0.5rem"
  DEFAULT: "0.875rem"
  lg: "1.25rem"
spacing:
  page-max: "74rem"
  section-gap: "2rem"
components:
  button: {}
  card: {}
  input: {}
  tabs: {}
---

# 医保报销计算器 MVP Design System

## Overview

### Creative North Star

一张经过核验的医保结算单：留白克制、信息层级清晰、金额醒目，正文是实用的表单，结果是可展开核查的结算凭据。

### Product context and register

- **Audience and primary job:** 企业 AI 实践评测者；快速完成一笔示例住院费用测算，并看清 MVP 的数据、规则和服务边界。
- **Target market(s) and evidence:** 中文企业内部评测场景；政策城市为题目给定的示例城市 A/B，不宣称覆盖真实全国政策。
- **Locale(s) and language policy:** 简体中文；金额用人民币两位小数，领域与 API 内部金额保持整数分。
- **Usage scene:** 桌面展示优先，同时允许手机上完成一次测算；评测者在有限时间内需要同时判断产品可用性和架构意识。
- **Register:** 产品型工具，不使用营销式“金融大屏”视觉。
- **Memorable signature:** 结果区采用“结算带”样式：左侧是结算编号与政策版本，右侧是加大的预计自费金额，下面留下可逐项核查的计算轨迹。
- **Restraint:** 填表、错误提示与方案说明使用安静的纸面化布局；图形只承担流程说明，不制造复杂仪表盘。
- **Anti-references:** 不做模板化的深色霓虹后台、不做夸张数据可视化、不把示例政策写成真实结算承诺。
- **Token ownership/runtime mapping:** 本文件是视觉意图与令牌源；`apps/offline-demo/src/styles.css` 和 `apps/service-web/app/globals.css` 用同名 CSS 变量实现，两个界面共享颜色、字体、圆角和间距语义。

## Colors

`ink` 用于核心文本与结构线；`teal` 是可执行操作和可信状态；`teal-soft` 只承载结果强调；`canvas` 是低刺激工作底色；`paper` 承载表单和结算单；`alert` 仅用于可恢复错误；`focus` 保证键盘焦点可见。默认仅提供浅色主题，强制高对比模式交给系统颜色。

## Typography

`display` 只用于页面标题与结算金额，带一点正式凭据感；`sans` 承担中文表单、说明和错误文案；`mono` 用于政策版本、请求编号和分单位数值。正文不使用斜体，中文文本保持 1.55 以上行高，金额列使用等宽数字特性。

## Layout

页面最大宽度遵循 `page-max`。宽屏将测算表单与结算结果并列；窄屏折叠为单列，计算按钮仍处在输入之后、结果之前。`报销测算` 与 `方案设计` 是同一页面的同行视图，用原生按钮与 ARIA tabs 模式切换。错误和加载位置预留，避免提交后跳动。

## Elevation & Depth

静态卡片以纸张色差和细边框建立层级，仅结算结果使用极浅阴影。不可让阴影替代错误、选择或焦点语义。

## Shapes

表单和按钮使用小圆角，结算带使用较大圆角。边框是细而低对比的青灰色；不使用药丸式控件来表达复杂选择。

## Components

### Foundational visual states

交互控件都有 hover、`focus-visible`、active、disabled、busy 和 error 状态。提交中按钮保持原宽度，显示“正在测算”；结果与错误均有可读的状态区域。动画仅用于结果结算带的短暂淡入，并遵守 `prefers-reduced-motion`。

### Buttons and actions

主操作为实心 `teal` 的“开始测算”；样例、视图切换和展开轨迹为次级操作。所有按钮使用原生 `<button>`，有可见焦点和中文可读标签。

### Navigation and data display

视图切换保留 tab 语义。计算轨迹是语义化列表；架构说明使用可收缩但默认完整可读的流程块，不伪装成实时监控图。

### Forms and overlays

表单使用原生 `<select>` 与数字输入，接受平台弹出层；每个字段有 label、帮助文案和就近错误。表单关闭原生校验气泡，由应用显示修正提示。没有 destructive action、对话框或 toast。

### Iconography

不用图标库；仅在步骤编号、状态点和展开箭头中使用文本与 CSS 图形，避免图标成为理解前提。

### Motion

仅允许 160–220ms 的透明度或色彩过渡，不能影响金额读取；减少动态偏好下停用。

### Content and data visualization

文案直接说明用户能控制的条件与系统能返回的结果。所有政策免责声明紧邻输入和结果；金额使用 `¥12,345.67` 格式，架构图使用文字链路，避免暗示真实在线接入。

## Do's and Don'ts

- **Do:** 让每个最终金额都能通过“计算明细”回溯。
- **Do:** 在两种运行模式中复用同一组颜色、字段标签和错误语言。
- **Don't:** 在界面中展示或编辑政策百分比作为用户输入。
- **Don't:** 把本地样例、模拟 AI 或内存缓存描述成生产服务。
