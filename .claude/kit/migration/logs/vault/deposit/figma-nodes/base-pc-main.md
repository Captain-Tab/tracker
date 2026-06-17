# Figma Node: Base Chain PC 主弹窗

URL: https://www.figma.com/design/Nd6fZEIJS8bjCvJxBZVQGi/SoDEX?node-id=430-35403

## 关键规格

### Frame 容器
- Width: 520px fixed
- Padding: 32px
- Gap (vertical): 24px
- Border radius: 6px
- Background: `#141419`
- Border: 1px `#232326`

### 标题区
- Title "Deposit to SLP Vault": 24px Semi Bold `#FFFFFF`, line-height 36
- Close icon: 36×36 padding 8/16
- Description 14/20 Regular `#B4B4B6`

### Alert "Must to know"
- Background: `#2F241D` (deep orange)
- Border radius: 4px
- Border-left: 3px `#F19D38`
- Text: 12/16 Regular `#F19D38`
- Padding: 8px 12px
- Gap: 12px
- chevron-down 右侧

### 表单选择行(Network / Coin 并排)
- 每格: bg `#000000`, radius 6px, padding 8px 16px, 内含 label 12/16 regular `#B4B4B6` + value 12/16 regular `#FFFFFF` + chevron

### Amount 输入
- Bg `#000000`, radius 6px, padding 10px 16px
- Label: "Amount (Min. 5 MAG7.ssi)" 12/16 regular `#B4B4B6`
- 右侧 "Max: 500.00" 12/16 `#F19D38` + 竖线 divider (1×12 `#232326`)

### Fees / You receive / Rate 区
- Vertical gap 10px
- 每行: 左 label `#B4B4B6` 右 value `#FFFFFF`, 12/16
- Rate 行 value 可能换行: "1 sMAG7.SLP = 1.0139655 MAG7.ssi ($0.85)"

### 按钮区
- 主按钮 "Deposit": 456×40, bg `#3E3E43`(disabled 状态), radius 6px, 文字 14/24 Medium `#000000`(反色) — **注意:此截图是 disabled 态**
- 次按钮 "Get MAG7.ssi": 456×40, border 1px `#FFFFFF`, text `#FFFFFF`

### 底部链接
- "Get Stack? Click to help" 12/16 `#F19D38`
- link-external-01 icon 16×16

## 色板提取

| 角色 | hex | 新项目 token (待补全) |
|---|---|---|
| 弹窗 bg | #141419 | bg-bg-black-primary-alt? |
| 弹窗 border | #232326 | border-primary? |
| 输入/选项 bg | #000000 | bg-black |
| 次要文字 | #B4B4B6 | text-text-secondary |
| 主文字 | #FFFFFF | text-white |
| Alert bg | #2F241D | **需新增 warning-bg token** |
| Alert 文字/边框 | #F19D38 | warning-primary |
| 主按钮 disabled bg | #3E3E43 | bg-secondary? |

## 字体

- 24/36 Semi Bold — 标题
- 14/20 Regular — 描述
- 14/24 Medium — 按钮
- 12/16 Regular — 标签/值/alert/链接
