export PS1='${debian_chroot:+($debian_chroot)}\u@\H:\[\033[1;32m\]\w'$EXPECTSSH_PS1_TAIL
export HISTCONTROL=ignoreboth:erasedups
export VIM_CLIPBOARD=$EXPECTSSH_TMPDIR/vim.clipboard.$USER
touch $VIM_CLIPBOARD
chmod 600 $VIM_CLIPBOARD || {
  echo "WARNING: could not chmod on $VIM_CLIPBOARD!"
}
export VIMINIT='map <c-v> :echon system("_ES_marker VIM_PASTE_CLIPBOARD") "\n."<cr>|vnoremap <C-c> y:call writefile(split(@","\n","b"),$VIM_CLIPBOARD)<cr>:!copy_to_clipboard $VIM_CLIPBOARD<cr>|colorscheme elflord|syntax enable|set noswapfile number hlsearch incsearch sw=2 ignorecase wrap nocompatible ruler ai showmatch modeline modelines=5 nobackup nowritebackup textwidth=0 expandtab formatoptions=croql wildignore=*.class path=.,,**|autocmd Filetype java setlocal omnifunc=javacomplete#Complete'
export EDITOR=/usr/bin/vim
export FCEDIT=$EDITOR
