from pathlib import Path

p = Path('src/components/admin/OrdersPanel.tsx')
s = p.read_text()

old = s
s = s.replace("const allowedTransition=(o:Order,next:string)=>{if(next==='cancelled')return !['delivered','cancelled'].includes(o.status);if(o.status==='pending')return next==='preparing';if(o.status==='preparing')return next==='ready';if(o.status==='ready')return o.order_type==='delivery'?next==='out_for_delivery':next==='delivered';if(o.status==='out_for_delivery')return o.order_type==='delivery'&&next==='delivered';return false};",
"const isDeliveryOrder=(orderType:string)=>orderType==='delivery'||orderType==='viagem';\n const allowedTransition=(o:Order,next:string)=>{if(next==='cancelled')return !['delivered','cancelled'].includes(o.status);if(o.status==='pending')return next==='preparing';if(o.status==='preparing')return next==='ready';if(o.status==='ready')return isDeliveryOrder(o.order_type)?next==='out_for_delivery':next==='delivered';if(o.status==='out_for_delivery')return isDeliveryOrder(o.order_type)&&next==='delivered';return false};")
s = s.replace("const isDelivery=order.order_type==='delivery';", "const isDelivery=isDeliveryOrder(order.order_type);")

if s == old:
    if "const isDeliveryOrder=(orderType:string)=>orderType==='delivery'||orderType==='viagem';" in s and "const isDelivery=isDeliveryOrder(order.order_type);" in s:
        print('delivery type contract already aligned')
        raise SystemExit(0)
    raise SystemExit('expected OrdersPanel delivery-type anchors not found')

required = [
    "const isDeliveryOrder=(orderType:string)=>orderType==='delivery'||orderType==='viagem';",
    "isDeliveryOrder(o.order_type)?next==='out_for_delivery':next==='delivered'",
    "isDeliveryOrder(o.order_type)&&next==='delivered'",
    "const isDelivery=isDeliveryOrder(order.order_type);",
]
if not all(x in s for x in required):
    raise SystemExit('delivery type hardening incomplete')

p.write_text(s)
