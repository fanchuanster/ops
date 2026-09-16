bname=wen_dev
bmain=master
git checkout $bmain
git branch -D $bname
git fetch
git pull
git push --delete origin $bname

git checkout -b $bname
git push --set-upstream origin $bname
