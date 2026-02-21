curl -X POST http://localhost:3001/api/v1/admin/tenants \
 -H "Content-Type: application/json" \
 -H "x-admin-secret: your_admin_secret_from_env" \
 -d '{"name":"Reethi Cafe","email":"admin@reethicafe.mv","initialCredits":1000}'
