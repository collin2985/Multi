#!/bin/bash
cd "$(dirname "$0")/public/models"

for backup in *-backup.glb; do
  base="${backup%-backup.glb}"
  output="${base}.glb"
  temp="${base}-temp.glb"

  echo "Re-optimizing: $base"
  npx gltf-transform resize "$backup" "$temp" --width 512 --height 512
  npx gltf-transform draco "$temp" "$output"
  rm -f "$temp"
done

echo "Done!"
