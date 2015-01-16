#export PS1='${debian_chroot:+($debian_chroot)}\u@\H:\[\033[1;32m\]\w'$EXPECTSSH_PS1_TAIL
export PS1='${debian_chroot:+($debian_chroot)}\u@\H:\[\033[1;32m\]\w:\033[7m\$\033[0m '
export HISTCONTROL=ignoreboth:erasedups FCEDIT=vim EDITOR=vim
