export const STARTERS = [
  {id:'tasks',category:'效率工具',title:'轻量任务清单',description:'把今天的事，安排得井井有条。',accent:'#6366f1',features:['添加任务','完成与筛选','本地保存'],prompt:'做一个轻量任务清单应用：可添加和删除任务、标记完成，支持全部/待完成/已完成筛选，显示剩余任务数。使用 localStorage 持久化。界面用靛蓝主色、清晰卡片和友好空状态，兼顾手机使用。'},
  {id:'habits',category:'生活管理',title:'每周习惯打卡',description:'从一个小习惯开始，看到每一步进展。',accent:'#16a085',features:['一周打卡','完成进度','本地保存'],prompt:'做一个每周习惯打卡应用：用户可以添加习惯，为本周每天切换打卡状态，显示每个习惯的周完成率与总进度，可删除习惯。使用 localStorage 保存并在刷新后恢复。界面用薄荷绿、七日网格、清楚的已完成状态，支持手机窄屏。'},
  {id:'expenses',category:'生活管理',title:'日常支出记录',description:'随手记一笔，让日常开销更清楚。',accent:'#e58b35',features:['添加记录','分类汇总','本地保存'],prompt:'做一个个人日常支出记录应用：输入名称、金额、日期和分类，可新增/删除记录，按月份和分类筛选，展示当前合计与分类统计。金额仅允许大于0的数字。使用 localStorage 保存，提供清空筛选和友好空状态。界面使用暖橙色、整洁表格，手机端改为卡片。'},
  {id:'portfolio',category:'个人展示',title:'个人作品集',description:'让你的作品拥有一个清楚、漂亮的入口。',accent:'#b459a5',features:['分类筛选','作品详情','响应式布局'],prompt:'做一个个人作品集网站：包含个人介绍、可按类别筛选的作品网格、点击作品打开详情弹窗，以及联系方式。使用原创 CSS 或 SVG 示意图作为默认封面，不依赖外部图片。支持键盘关闭弹窗、清晰焦点与手机布局。界面采用简洁编辑风格、留白和梅紫色点缀。'},
] as const;
export type Starter = typeof STARTERS[number];
