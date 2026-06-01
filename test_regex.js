var tfMatch1 = " Đ Đ S S".match(/\b([ĐSđs])\s*([ĐSđs])\s*([ĐSđs])\s*([ĐSđs])\b/);
WScript.Echo("tfMatch1: " + (tfMatch1 ? tfMatch1[0] : "null"));

var tfMatch2 = " S S S Đ".match(/\b([ĐSđs])\s*([ĐSđs])\s*([ĐSđs])\s*([ĐSđs])\b/);
WScript.Echo("tfMatch2: " + (tfMatch2 ? tfMatch2[0] : "null"));
